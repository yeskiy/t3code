import {
  type ForkTranscriptBackup,
  type ForkTranscriptBackupsInput,
  type ForkTranscriptBlockTextInput,
  type ForkTranscriptDeleteBackupInput,
  ForkTranscriptEditError,
  type ForkTranscriptItemLink,
  type ForkTranscriptLoadInput,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPreviewInput,
  type ForkTranscriptPreviewResult,
  type ForkTranscriptRestoreInput,
  type ForkTranscriptSaveInput,
  type ForkTranscriptSaveResult,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import { EventSinkV2 } from "../../orchestration-v2/EventSink.ts";
import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import {
  type ProjectionRecords,
  ProjectionStoreV2,
} from "../../orchestration-v2/ProjectionStore.ts";
import { ProviderSessionManagerV2 } from "../../orchestration-v2/ProviderSessionManager.ts";
import { ThreadCommandExecutor } from "../../orchestration-v2/ThreadCommandExecutor.ts";
import { resolveClaudeHomePath } from "../../provider/Drivers/ClaudeHome.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { diffUnits } from "./core/diff.ts";
import { parseJsonl, serializeJsonl } from "./core/jsonl.ts";
import { activeLeaf } from "./core/model.ts";
import { tryApply } from "./core/ops.ts";
import type { Transcript } from "./core/types.ts";
import { validate } from "./core/validate.ts";
import { fullBlockText, fullRawText, unitViews } from "./core/view.ts";
import { lastCompactionItemId, mapUnitsToItems } from "./itemMap.ts";
import { type MirrorPlan, planMirror, remapCursor, remirror } from "./projectionMirror.ts";
import {
  BACKUPS_KEPT,
  deleteBackup as deleteBackupFile,
  type FreshTranscript,
  listBackups,
  locateTranscript,
  pruneBackups,
  readBackup,
  readFresh,
  settle,
  writeBackup,
  writeTranscript,
} from "./transcriptFiles.ts";

export class ForkTranscriptEdit extends Context.Service<
  ForkTranscriptEdit,
  {
    readonly load: (
      input: ForkTranscriptLoadInput,
    ) => Effect.Effect<ForkTranscriptLoadResult, ForkTranscriptEditError>;
    readonly preview: (
      input: ForkTranscriptPreviewInput,
    ) => Effect.Effect<ForkTranscriptPreviewResult, ForkTranscriptEditError>;
    readonly save: (
      input: ForkTranscriptSaveInput,
    ) => Effect.Effect<ForkTranscriptSaveResult, ForkTranscriptEditError>;
    readonly backups: (
      input: ForkTranscriptBackupsInput,
    ) => Effect.Effect<ReadonlyArray<ForkTranscriptBackup>, ForkTranscriptEditError>;
    readonly restore: (
      input: ForkTranscriptRestoreInput,
    ) => Effect.Effect<ForkTranscriptSaveResult, ForkTranscriptEditError>;
    readonly deleteBackup: (
      input: ForkTranscriptDeleteBackupInput,
    ) => Effect.Effect<void, ForkTranscriptEditError>;
    readonly blockText: (
      input: ForkTranscriptBlockTextInput,
    ) => Effect.Effect<string, ForkTranscriptEditError>;
  }
>()("t3/fork/transcriptEdit/ForkTranscriptEdit") {}

const TOOL_TEXT_LIMIT = 2_000;
const CACHE_LIMIT = 4;
const STOP_POLL = Duration.millis(500);
const STOP_POLLS = 40;
const WORKING_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);
const RECORD_FIELDS = [
  "turnItems",
  "messages",
  "runs",
  "providerThreads",
  "providerTurns",
] as const;

const NOT_CLAUDE = "Transcript editing works for Claude threads only.";
const BUSY =
  "The thread is working now. Stopping it ends the current step. Confirm the stop to save.";
const BUSY_SESSION = "Claude still works in this session. Save again when it is idle.";
const STALE = "The session file changed after it was loaded. Reload the transcript and try again.";
const CHANGED_AFTER_STOP =
  "The session wrote new messages before it stopped. It stays stopped. Reload, check your changes, and save again.";
const STOP_FAILED = "The thread did not stop in 20 seconds. The session file is unchanged.";
export const CONTINUE_TEXT =
  "Your previous step was interrupted when the session stopped. Continue the task where you left off.";

const ClaudeHomeConfig = Schema.Struct({ homePath: Schema.optional(Schema.String) });
const decodeClaudeHomeConfig = Schema.decodeUnknownOption(ClaudeHomeConfig);

const editError = (code: ForkTranscriptEditError["code"], detail: string) =>
  new ForkTranscriptEditError({ code, detail });

const isWorking = (runs: ReadonlyArray<OrchestrationV2Run>): boolean =>
  runs.some((run) => WORKING_STATUSES.has(run.status));

const isRealCursor = (nativeId: string | null | undefined): nativeId is string =>
  typeof nativeId === "string" && !nativeId.startsWith("turn:");

const itemLinks = (
  transcript: Transcript,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  threadId: ThreadId,
): ReadonlyArray<ForkTranscriptItemLink> => {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  return [...mapUnitsToItems({ transcript, items, threadId }).values()].flatMap((mapped) =>
    mapped.itemIds.map((itemId) => ({
      itemId,
      unitKey: mapped.unitKey,
      inherited: byId.get(itemId)?.threadId !== threadId,
    })),
  );
};

const pickProviderThread = (
  activeId: OrchestrationV2ProviderThread["id"] | null,
  providerThreads: ReadonlyArray<OrchestrationV2ProviderThread>,
): OrchestrationV2ProviderThread | undefined =>
  providerThreads.find((providerThread) => providerThread.id === activeId) ??
  providerThreads.toSorted(
    (a, b) =>
      (b.lastRunOrdinal ?? 0) - (a.lastRunOrdinal ?? 0) ||
      DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
  )[0];

type Produced = { readonly edited: Transcript; readonly text: string };

type MirrorInput = {
  readonly fresh: FreshTranscript;
  readonly edited: Transcript;
  readonly records: ThreadRecords;
  readonly providerThreadId: OrchestrationV2ProviderThread["id"];
  readonly now: DateTime.Utc;
  readonly newId: (seed: string) => string;
};

type ThreadRecords = ProjectionRecords<(typeof RECORD_FIELDS)[number]>;

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStoreV2;
  const eventSink = yield* EventSinkV2;
  const threadCommands = yield* ThreadCommandExecutor;
  const sessions = yield* ProviderSessionManagerV2;
  const orchestrator = yield* OrchestratorV2;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettingsService;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const sessionLocks = yield* KeyedLock.make<string>();
  const cache = yield* Ref.make<ReadonlyMap<string, FreshTranscript>>(new Map());

  const withFiles = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathService),
    );

  const readRecords = (threadId: ThreadId) =>
    projections.getThreadRecords(threadId, RECORD_FIELDS).pipe(Effect.orDie);

  const readRuns = (threadId: ThreadId) =>
    projections.getThreadRecords(threadId, ["runs"]).pipe(
      Effect.map((records) => records.runs),
      Effect.orDie,
    );

  const readFile = (filePath: string) =>
    withFiles(readFresh(filePath)).pipe(
      Effect.mapError(() => editError("no-session-file", "The session file cannot be read.")),
    );

  const remember = (threadId: ThreadId, fresh: FreshTranscript) =>
    Ref.update(cache, (current) => {
      const key = `${threadId}:${fresh.key}`;
      const kept = [...current].filter(([entry]) => entry !== key);
      return new Map([...kept, [key, fresh] as const].slice(-CACHE_LIMIT));
    });

  const resolveConfigDir = Effect.fn("fork.transcriptEdit.resolveConfigDir")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const instance = (yield* settings.getSettings.pipe(Effect.orDie)).providerInstances[instanceId];
    const homePath = Option.match(decodeClaudeHomeConfig(instance?.config), {
      onNone: () => "",
      onSome: (decoded) => decoded.homePath ?? "",
    });
    const environment = yield* mergeProviderInstanceEnvironment(instance?.environment, process.env);
    return yield* resolveClaudeHomePath({ homePath }, environment).pipe(
      Effect.provideService(Path.Path, pathService),
    );
  });

  const resolveTarget = Effect.fn("fork.transcriptEdit.resolveTarget")(function* (
    threadId: ThreadId,
  ) {
    const records = yield* readRecords(threadId);
    const providerThread = pickProviderThread(
      records.thread.activeProviderThreadId,
      records.providerThreads.filter((candidate) => candidate.appThreadId === threadId),
    );
    if (providerThread === undefined || providerThread.driver !== "claudeAgent") {
      return yield* editError("not-claude", NOT_CLAUDE);
    }
    const sessionId = providerThread.nativeThreadRef?.nativeId ?? null;
    if (sessionId === null) {
      return yield* editError("no-session-file", "The thread has no Claude session yet.");
    }
    const configDir = yield* resolveConfigDir(providerThread.providerInstanceId);
    const filePath = yield* withFiles(locateTranscript({ configDir, sessionId }));
    if (filePath === null) {
      return yield* editError(
        "no-session-file",
        `No session file exists for session ${sessionId}.`,
      );
    }
    return { records, providerThread, sessionId, path: filePath };
  });

  const cachedBase = Effect.fn("fork.transcriptEdit.cachedBase")(function* (
    threadId: ThreadId,
    baseKey: string,
  ) {
    const cached = (yield* Ref.get(cache)).get(`${threadId}:${baseKey}`);
    if (cached !== undefined) return cached;
    const target = yield* resolveTarget(threadId);
    const fresh = yield* readFile(target.path);
    if (fresh.key !== baseKey) return yield* editError("stale", STALE);
    yield* remember(threadId, fresh);
    return fresh;
  });

  const waitUntilIdle = (
    threadId: ThreadId,
    polls: number,
  ): Effect.Effect<void, ForkTranscriptEditError> =>
    Effect.flatMap(readRuns(threadId), (runs) => {
      if (!isWorking(runs)) return Effect.void;
      if (polls <= 0) return Effect.fail(editError("stopFailed", STOP_FAILED));
      return Effect.sleep(STOP_POLL).pipe(Effect.andThen(waitUntilIdle(threadId, polls - 1)));
    });

  const stopIfWorking = Effect.fn("fork.transcriptEdit.stopIfWorking")(function* (
    threadId: ThreadId,
    confirmStop: boolean,
  ) {
    if (!isWorking(yield* readRuns(threadId))) return false;
    if (!confirmStop) return yield* editError("busy", BUSY);
    const commandId = yield* ids.allocate
      .command({ fixtureName: "transcript-edit", commandName: "stop" })
      .pipe(Effect.orDie);
    yield* orchestrator
      .dispatch({
        type: "thread.stop",
        commandId,
        threadId,
        reason: "transcript edit",
        scope: "turn",
      })
      .pipe(Effect.mapError(() => editError("stopFailed", STOP_FAILED)));
    yield* waitUntilIdle(threadId, STOP_POLLS);
    return true;
  });

  const releaseSession = Effect.fn("fork.transcriptEdit.releaseSession")(function* (
    threadId: ThreadId,
    providerThread: OrchestrationV2ProviderThread,
  ) {
    const providerSessionId = providerThread.providerSessionId;
    if (providerSessionId === null || !(yield* sessions.isLive(providerSessionId))) return;
    const runs = yield* readRuns(threadId);
    const released = yield* sessions
      .releaseUnlessBusy({
        providerSessionId,
        ownProviderThreadIds: [],
        throughRunOrdinal: Math.max(0, ...runs.map((run) => run.ordinal)),
        reason: "manual_shutdown",
        detail: "transcript edit",
      })
      .pipe(Effect.mapError(() => editError("busy", BUSY_SESSION)));
    if (!released) return yield* editError("busy", BUSY_SESSION);
  });

  const mirrorEvents = Effect.fn("fork.transcriptEdit.mirrorEvents")(function* (input: {
    readonly threadId: ThreadId;
    readonly plan: MirrorPlan;
    readonly base: Transcript;
    readonly edited: Transcript;
    readonly records: ThreadRecords;
    readonly providerThreadId: OrchestrationV2ProviderThread["id"];
    readonly now: DateTime.Utc;
  }) {
    const { threadId, now } = input;
    const nextId = () => ids.allocate.event({ threadId }).pipe(Effect.orDie);
    const providerThread = input.records.providerThreads.find(
      (candidate) => candidate.id === input.providerThreadId,
    );
    const leaf = activeLeaf(input.edited);
    const messages = yield* Effect.forEach(input.plan.messages, (message) =>
      Effect.map(nextId(), (id): OrchestrationV2DomainEvent => ({
        id,
        type: "message.updated",
        threadId,
        ...(message.runId === null ? {} : { runId: message.runId }),
        occurredAt: now,
        payload: message,
      })),
    );
    const items = yield* Effect.forEach(input.plan.items, (item) =>
      Effect.map(nextId(), (id): OrchestrationV2DomainEvent => ({
        id,
        type: "turn-item.updated",
        threadId,
        ...(item.runId === null ? {} : { runId: item.runId }),
        ...(item.nodeId === null ? {} : { nodeId: item.nodeId }),
        occurredAt: now,
        payload: item,
      })),
    );
    const head =
      providerThread === undefined || leaf === null
        ? []
        : [
            yield* Effect.map(nextId(), (id): OrchestrationV2DomainEvent => ({
              id,
              type: "provider-thread.updated",
              threadId,
              driver: providerThread.driver,
              providerInstanceId: providerThread.providerInstanceId,
              occurredAt: now,
              payload: {
                ...providerThread,
                nativeConversationHeadRef: {
                  driver: providerThread.driver,
                  nativeId: leaf,
                  strength: "weak",
                },
                updatedAt: now,
              },
            })),
          ];
    const cursors = input.records.providerTurns.flatMap((turn) => {
      const ref = turn.nativeTurnRef;
      if (turn.providerThreadId !== input.providerThreadId || !isRealCursor(ref?.nativeId)) {
        return [];
      }
      const moved = remapCursor({ edited: input.edited, base: input.base, cursor: ref.nativeId });
      return moved === null || moved === ref.nativeId
        ? []
        : [{ ...turn, nativeTurnRef: { ...ref, nativeId: moved } }];
    });
    const turns = yield* Effect.forEach(cursors, (turn) =>
      Effect.map(nextId(), (id): OrchestrationV2DomainEvent => ({
        id,
        type: "provider-turn.updated",
        threadId,
        nodeId: turn.nodeId,
        ...(providerThread === undefined
          ? {}
          : {
              driver: providerThread.driver,
              providerInstanceId: providerThread.providerInstanceId,
            }),
        occurredAt: now,
        payload: turn,
      })),
    );
    return [...messages, ...items, ...head, ...turns];
  });

  const writeLocked = Effect.fn("fork.transcriptEdit.writeLocked")(function* (input: {
    readonly threadId: ThreadId;
    readonly baseKey: string;
    readonly stoppedTurn: boolean;
    readonly sessionId: string;
    readonly path: string;
    readonly providerThreadId: OrchestrationV2ProviderThread["id"];
    readonly produce: (fresh: FreshTranscript) => Effect.Effect<Produced, ForkTranscriptEditError>;
    readonly mirror: (input: MirrorInput) => MirrorPlan;
  }) {
    const records = yield* readRecords(input.threadId);
    if (isWorking(records.runs)) return yield* editError("busy", BUSY);
    yield* withFiles(settle(input.path));
    const fresh = yield* readFile(input.path);
    if (fresh.key !== input.baseKey) {
      return yield* editError("changed", input.stoppedTurn ? CHANGED_AFTER_STOP : STALE);
    }
    const produced = yield* input.produce(fresh);
    const now = yield* DateTime.now;
    const backup = yield* withFiles(
      writeBackup({
        stateDir: config.stateDir,
        sessionId: input.sessionId,
        text: fresh.text,
        now: DateTime.toDateUtc(now),
      }),
    ).pipe(
      Effect.mapError(() =>
        editError("writeFailed", "The backup cannot be written. The session file is unchanged."),
      ),
    );
    yield* withFiles(writeTranscript(input.path, produced.text)).pipe(
      Effect.mapError(() =>
        editError("writeFailed", `The session file cannot be written. Backup ${backup} holds it.`),
      ),
    );
    yield* withFiles(
      pruneBackups({ stateDir: config.stateDir, sessionId: input.sessionId, keep: BACKUPS_KEPT }),
    );
    const token = yield* ids.allocate
      .command({ fixtureName: "transcript-edit", commandName: "save" })
      .pipe(Effect.orDie);
    const plan = input.mirror({
      fresh,
      edited: produced.edited,
      records,
      providerThreadId: input.providerThreadId,
      now,
      newId: (seed) => `${token}:${seed}`,
    });
    const events = yield* mirrorEvents({
      threadId: input.threadId,
      plan,
      base: fresh.base,
      edited: produced.edited,
      records,
      providerThreadId: input.providerThreadId,
      now,
    });
    // Positions first: EventSink keeps a stored ordinal that lies inside its run range.
    yield* sql
      .withTransaction(
        Effect.forEach(
          plan.positions,
          (position) => sql`
            INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
            VALUES (${input.threadId}, ${position.turnItemId}, ${position.ordinal})
            ON CONFLICT(thread_id, turn_item_id) DO UPDATE SET ordinal = excluded.ordinal
          `,
          { concurrency: 1, discard: true },
        ).pipe(Effect.andThen(eventSink.write({ events }))),
      )
      .pipe(
        Effect.mapError(() =>
          editError(
            "writeFailed",
            `The session file is saved, but the timeline update failed. Restore backup ${backup} to undo it.`,
          ),
        ),
      );
    const saved = yield* readFile(input.path);
    yield* remember(input.threadId, saved);
    yield* Effect.logInfo("fork.transcript-edit.saved", {
      threadId: input.threadId,
      sessionId: input.sessionId,
      events: events.length,
      unmappedUnits: plan.unmappedUnits,
      inheritedUnits: plan.inheritedUnits,
    });
    return {
      baseKey: saved.key,
      units: unitViews(saved.base, TOOL_TEXT_LIMIT),
      backup,
      unmappedUnits: plan.unmappedUnits,
      inheritedUnits: plan.inheritedUnits,
    };
  });

  const continueTask = Effect.fn("fork.transcriptEdit.continueTask")(
    function* (threadId: ThreadId) {
      const { messages } = yield* projections.getThreadRecords(threadId, ["messages"]);
      const messageId = yield* ids.allocate.message({ threadId, ordinal: messages.length + 1 });
      const commandId = yield* ids.allocate.command({
        fixtureName: "transcript-edit",
        commandName: "continue",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId,
        threadId,
        messageId,
        text: CONTINUE_TEXT,
        attachments: [],
        createdBy: "user",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch(() => Effect.logWarning("fork.transcript-edit.continue-failed", { threadId })),
      ),
  );

  const commit = Effect.fn("fork.transcriptEdit.commit")(function* (input: {
    readonly threadId: ThreadId;
    readonly baseKey: string;
    readonly confirmStop: boolean;
    readonly after: "idle" | "continue";
    readonly produce: (fresh: FreshTranscript) => Effect.Effect<Produced, ForkTranscriptEditError>;
    readonly mirror: (input: MirrorInput) => MirrorPlan;
  }) {
    const target = yield* resolveTarget(input.threadId);
    return yield* sessionLocks.withLock(
      target.path,
      Effect.gen(function* () {
        // A file that changed before the stop fails here, so a save never stops a turn for nothing.
        if ((yield* readFile(target.path)).key !== input.baseKey) {
          return yield* editError("stale", STALE);
        }
        const stoppedTurn = yield* stopIfWorking(input.threadId, input.confirmStop);
        yield* releaseSession(input.threadId, target.providerThread);
        const saved = yield* threadCommands.withLock(
          input.threadId,
          writeLocked({
            threadId: input.threadId,
            baseKey: input.baseKey,
            stoppedTurn,
            sessionId: target.sessionId,
            path: target.path,
            providerThreadId: target.providerThread.id,
            produce: input.produce,
            mirror: input.mirror,
          }),
        );
        if (stoppedTurn && input.after === "continue") yield* continueTask(input.threadId);
        return { ...saved, stoppedTurn };
      }),
    );
  });

  return ForkTranscriptEdit.of({
    load: Effect.fn("fork.transcriptEdit.load")(function* (input) {
      const target = yield* resolveTarget(input.threadId);
      const fresh = yield* readFile(target.path);
      yield* remember(input.threadId, fresh);
      const working = isWorking(target.records.runs);
      return {
        sessionId: target.sessionId,
        baseKey: fresh.key,
        units: unitViews(fresh.base, TOOL_TEXT_LIMIT),
        links: itemLinks(fresh.base, target.records.turnItems, input.threadId),
        compactionItemId: lastCompactionItemId(fresh.base, target.records.turnItems),
        validation: validate(fresh.base, fresh.base),
        live: { editable: true, reason: working ? "working" : null, working },
      };
    }),

    preview: Effect.fn("fork.transcriptEdit.preview")(function* (input) {
      const base = yield* cachedBase(input.threadId, input.baseKey);
      const applied = tryApply(
        base.base,
        input.ops.map((pending) => pending.op),
      );
      return applied.ok
        ? {
            units: unitViews(applied.transcript, TOOL_TEXT_LIMIT),
            validation: validate(base.base, applied.transcript),
            diff: diffUnits(base.base, applied.transcript),
            failedAt: null,
          }
        : {
            units: unitViews(base.base, TOOL_TEXT_LIMIT),
            validation: validate(base.base, base.base),
            diff: [],
            failedAt: { index: applied.index, message: applied.error },
          };
    }),

    save: Effect.fn("fork.transcriptEdit.save")(function* (input) {
      return yield* commit({
        threadId: input.threadId,
        baseKey: input.baseKey,
        confirmStop: input.confirmStop,
        after: input.after,
        produce: (fresh) => {
          const applied = tryApply(
            fresh.base,
            input.ops.map((pending) => pending.op),
          );
          if (!applied.ok) {
            return Effect.fail(
              editError(
                "changed",
                `Change ${applied.index + 1} no longer applies: ${applied.error}`,
              ),
            );
          }
          const { errors } = validate(fresh.base, applied.transcript);
          return errors.length > 0
            ? Effect.fail(editError("invalid", errors.map((issue) => issue.message).join(" ")))
            : Effect.succeed({
                edited: applied.transcript,
                text: serializeJsonl(applied.transcript),
              });
        },
        mirror: ({ fresh, records, providerThreadId, now, newId }) =>
          planMirror({
            base: fresh.base,
            ops: input.ops.map((pending) => pending.op),
            items: records.turnItems,
            messages: records.messages,
            threadId: input.threadId,
            providerThreadId,
            now,
            newId,
          }),
      });
    }),

    restore: Effect.fn("fork.transcriptEdit.restore")(function* (input) {
      const target = yield* resolveTarget(input.threadId);
      return yield* commit({
        threadId: input.threadId,
        baseKey: input.baseKey,
        confirmStop: input.confirmStop,
        after: "idle",
        produce: () =>
          withFiles(
            readBackup({
              stateDir: config.stateDir,
              sessionId: target.sessionId,
              transcriptPath: target.path,
              name: input.backup,
              source: input.source,
            }),
          ).pipe(Effect.map((text) => ({ edited: parseJsonl(text), text }))),
        mirror: ({ edited, records, now }) =>
          remirror({
            transcript: edited,
            items: records.turnItems,
            messages: records.messages,
            threadId: input.threadId,
            now,
          }),
      });
    }),

    backups: Effect.fn("fork.transcriptEdit.backups")(function* (input) {
      const target = yield* resolveTarget(input.threadId);
      return yield* withFiles(
        listBackups({
          stateDir: config.stateDir,
          sessionId: target.sessionId,
          transcriptPath: target.path,
        }),
      );
    }),

    deleteBackup: Effect.fn("fork.transcriptEdit.deleteBackup")(function* (input) {
      const target = yield* resolveTarget(input.threadId);
      yield* withFiles(
        deleteBackupFile({
          stateDir: config.stateDir,
          sessionId: target.sessionId,
          transcriptPath: target.path,
          name: input.backup,
          source: input.source,
        }),
      );
    }),

    blockText: Effect.fn("fork.transcriptEdit.blockText")(function* (input) {
      const base = yield* cachedBase(input.threadId, input.baseKey);
      const text =
        input.part === "raw"
          ? fullRawText(base.base, input.uuid)
          : fullBlockText(base.base, input.uuid, input.index);
      if (text === null) {
        return yield* editError("invalid", `No block text exists for entry ${input.uuid}.`);
      }
      return text;
    }),
  });
});

export const layer = Layer.effect(ForkTranscriptEdit, make);
