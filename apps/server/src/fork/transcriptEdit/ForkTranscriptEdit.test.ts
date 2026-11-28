import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  type ForkTranscriptPendingOp,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { ProviderSessionManagerV2 } from "../../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { COMPACTED_FIXTURE_TEXT, FIXTURE_TEXT } from "./core/fixtures.ts";
import {
  CONTINUE_TEXT,
  ForkTranscriptEdit,
  layer as forkTranscriptEditLayer,
} from "./ForkTranscriptEdit.ts";

const AT = DateTime.makeUnsafe("2026-11-25T10:00:00.000Z");
const TX_THREAD_ID = ThreadId.make("thread:tx");
const TX_INSTANCE = ProviderInstanceId.make("claudeAgent");

const appThread = (id: ThreadId): OrchestrationV2AppThread => ({
  id,
  projectId: ProjectId.make("project:edit"),
  title: "Edit",
  createdBy: "user",
  creationSource: "web",
  providerInstanceId: TX_INSTANCE,
  modelSelection: { instanceId: TX_INSTANCE, model: "claude-opus-5-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  createdAt: AT,
  updatedAt: AT,
  archivedAt: null,
  deletedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  lastVisitedAt: null,
});

const sinkLayer = EventSink.layer.pipe(
  Layer.provideMerge(
    Layer.merge(
      EventStore.layer,
      ProjectionStore.layer.pipe(Layer.provide(NodeCrypto.layerDigest)),
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

describe("transaction assumption", () => {
  it.effect("rolls back a position row and an event write that share one transaction", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* sink.write({
        events: [
          {
            id: EventId.make("event:tx:created"),
            type: "thread.created",
            threadId: TX_THREAD_ID,
            occurredAt: AT,
            payload: appThread(TX_THREAD_ID),
          },
        ],
      });
      const before = yield* sink.latestSequence();
      const itemEvent = (id: string, ordinal: number): OrchestrationV2DomainEvent => ({
        id: EventId.make(`event:tx:${id}`),
        type: "turn-item.updated",
        threadId: TX_THREAD_ID,
        occurredAt: AT,
        payload: {
          id: TurnItemId.make(id),
          threadId: TX_THREAD_ID,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal,
          status: "completed",
          title: null,
          startedAt: AT,
          completedAt: AT,
          updatedAt: AT,
          type: "assistant_message",
          messageId: MessageId.make(`message:${id}`),
          text: "x",
          streaming: false,
        },
      });
      const writeBoth = (id: string, ordinal: number) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
            VALUES (${TX_THREAD_ID}, ${id}, ${ordinal})
            ON CONFLICT(thread_id, turn_item_id) DO UPDATE SET ordinal = excluded.ordinal
          `;
          yield* sink.write({ events: [itemEvent(id, ordinal)] });
        });

      const failed = yield* sql
        .withTransaction(
          writeBoth("item:rolled-back", 500).pipe(Effect.andThen(Effect.fail("boom" as const))),
        )
        .pipe(Effect.flip);
      assert.equal(failed, "boom");
      const afterFailure = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_v2_turn_item_positions
        WHERE thread_id = ${TX_THREAD_ID} AND turn_item_id = 'item:rolled-back'
      `;
      assert.equal(afterFailure[0]?.n, 0);
      assert.equal(yield* sink.latestSequence(), before);
      const failedRecords = yield* projections.getThreadRecords(TX_THREAD_ID, ["turnItems"]);
      assert.deepEqual(failedRecords.turnItems, []);

      yield* sql.withTransaction(writeBoth("item:committed", 700));
      const committed = yield* projections.getThreadRecords(TX_THREAD_ID, ["turnItems"]);
      assert.deepEqual(
        committed.turnItems.map((item) => [item.id, item.ordinal]),
        [["item:committed", 700]],
      );
      assert.equal(yield* sink.latestSequence(), before + 1);
    }).pipe(Effect.provide(sinkLayer)),
  );
});

const SESSION_ID = "4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const THREAD_ID = ThreadId.make("thread:edit");
const CODEX_THREAD_ID = ThreadId.make("thread:codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CLAUDE_INSTANCE = ProviderInstanceId.make("claudeAgent");
const CODEX_INSTANCE = ProviderInstanceId.make("codex");
const PROVIDER_THREAD_ID = ProviderThreadId.make("provider-thread:edit");
const CODEX_PROVIDER_THREAD_ID = ProviderThreadId.make("provider-thread:codex");
const PROVIDER_SESSION_ID = ProviderSessionId.make("provider-session:edit");
const RUN_1 = RunId.make("run:edit:1");
const RUN_2 = RunId.make("run:edit:2");

type Fake = {
  live: boolean;
  released: boolean;
  readonly releaseCalls: Array<unknown>;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
  onStop: Effect.Effect<unknown, EventSink.EventSinkV2Error>;
};

type Dirs = { readonly configDir: string; readonly stateDir: string; readonly filePath: string };

const run = (
  id: RunId,
  ordinal: number,
  status: OrchestrationV2Run["status"],
): OrchestrationV2Run => ({
  id,
  threadId: THREAD_ID,
  ordinal,
  providerInstanceId: CLAUDE_INSTANCE,
  modelSelection: { instanceId: CLAUDE_INSTANCE, model: "claude-opus-5-5" },
  providerThreadId: PROVIDER_THREAD_ID,
  userMessageId: MessageId.make(`msg:${id}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  queuePosition: null,
  requestedAt: AT,
  startedAt: AT,
  completedAt: status === "running" ? null : AT,
  checkpointId: null,
  contextHandoffId: null,
});

const itemBase = (id: string, runId: RunId, nativeId: string | null, ordinal: number) => ({
  id: TurnItemId.make(id),
  threadId: THREAD_ID,
  runId,
  nodeId: null,
  providerThreadId: PROVIDER_THREAD_ID,
  providerTurnId: null,
  nativeItemRef:
    nativeId === null ? null : { driver: CLAUDE, nativeId, strength: "strong" as const },
  parentItemId: null,
  ordinal,
  status: "completed" as const,
  title: null,
  startedAt: AT,
  completedAt: AT,
  updatedAt: AT,
});

const userItem = (
  id: string,
  runId: RunId,
  ordinal: number,
  text: string,
): OrchestrationV2TurnItem => ({
  ...itemBase(id, runId, null, ordinal),
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: MessageId.make(`msg:${id}`),
  inputIntent: "turn_start",
  text,
  attachments: [],
});

const assistantItem = (
  id: string,
  runId: RunId,
  nativeId: string,
  ordinal: number,
  text: string,
): OrchestrationV2TurnItem => ({
  ...itemBase(id, runId, nativeId, ordinal),
  type: "assistant_message",
  messageId: MessageId.make(`msg:${id}`),
  text,
  streaming: false,
});

const message = (
  id: string,
  runId: RunId,
  role: "user" | "assistant",
  text: string,
): OrchestrationV2ConversationMessage => ({
  createdBy: role === "user" ? "user" : "agent",
  creationSource: role === "user" ? "web" : "provider",
  id: MessageId.make(`msg:${id}`),
  threadId: THREAD_ID,
  runId,
  nodeId: null,
  role,
  text,
  attachments: [],
  streaming: false,
  createdAt: AT,
  updatedAt: AT,
});

const providerThreadEvent = (input: {
  readonly id: ProviderThreadId;
  readonly threadId: ThreadId;
  readonly driver: string;
  readonly instance: ProviderInstanceId;
}): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:seed:${input.id}`),
  type: "provider-thread.updated",
  threadId: input.threadId,
  occurredAt: AT,
  payload: {
    id: input.id,
    driver: ProviderDriverKind.make(input.driver),
    providerInstanceId: input.instance,
    providerSessionId: PROVIDER_SESSION_ID,
    appThreadId: input.threadId,
    ownerNodeId: null,
    nativeThreadRef: {
      driver: ProviderDriverKind.make(input.driver),
      nativeId: SESSION_ID,
      strength: "strong",
    },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 2,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: null,
    nativeMetadata: null,
    goal: null,
    createdAt: AT,
    updatedAt: AT,
  },
});

const providerTurnEvent = (
  id: string,
  ordinal: number,
  cursor: string,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:seed:${id}`),
  type: "provider-turn.updated",
  threadId: THREAD_ID,
  nodeId: NodeId.make(`node:${id}`),
  occurredAt: AT,
  payload: {
    id: ProviderTurnId.make(id),
    providerThreadId: PROVIDER_THREAD_ID,
    nodeId: NodeId.make(`node:${id}`),
    runAttemptId: null,
    nativeTurnRef: { driver: CLAUDE, nativeId: cursor, strength: "strong" },
    ordinal,
    status: "completed",
    startedAt: AT,
    completedAt: AT,
  },
});

const seedEvents = (
  run2Status: OrchestrationV2Run["status"],
): ReadonlyArray<OrchestrationV2DomainEvent> => {
  const items: ReadonlyArray<OrchestrationV2TurnItem> = [
    userItem("item:u1", RUN_1, 1_000_001, "one"),
    {
      ...itemBase("item:a1t", RUN_1, "a1t:thinking:0", 1_000_002),
      type: "reasoning",
      text: "hm",
      streaming: false,
    },
    assistantItem("item:a1", RUN_1, "a1", 1_000_003, "reply one"),
    {
      ...itemBase("item:tool1", RUN_1, "toolu_1", 1_000_004),
      type: "command_execution",
      input: "ls",
    },
    assistantItem("item:a3", RUN_1, "a3", 1_000_005, "done"),
    userItem("item:u2", RUN_2, 2_000_001, "two"),
    assistantItem("item:a4", RUN_2, "a4", 2_000_002, "reply two"),
  ];
  const messages = [
    message("item:u1", RUN_1, "user", "one"),
    message("item:a1", RUN_1, "assistant", "reply one"),
    message("item:a3", RUN_1, "assistant", "done"),
    message("item:u2", RUN_2, "user", "two"),
    message("item:a4", RUN_2, "assistant", "reply two"),
  ];
  return [
    {
      id: EventId.make("event:seed:thread"),
      type: "thread.created",
      threadId: THREAD_ID,
      occurredAt: AT,
      payload: { ...appThread(THREAD_ID), activeProviderThreadId: PROVIDER_THREAD_ID },
    },
    {
      id: EventId.make("event:seed:codex-thread"),
      type: "thread.created",
      threadId: CODEX_THREAD_ID,
      occurredAt: AT,
      payload: {
        ...appThread(CODEX_THREAD_ID),
        providerInstanceId: CODEX_INSTANCE,
        activeProviderThreadId: CODEX_PROVIDER_THREAD_ID,
      },
    },
    ...[run(RUN_1, 1, "completed"), run(RUN_2, 2, run2Status)].map(
      (payload): OrchestrationV2DomainEvent => ({
        id: EventId.make(`event:seed:${payload.id}`),
        type: "run.created",
        threadId: THREAD_ID,
        runId: payload.id,
        occurredAt: AT,
        payload,
      }),
    ),
    providerThreadEvent({
      id: PROVIDER_THREAD_ID,
      threadId: THREAD_ID,
      driver: "claudeAgent",
      instance: CLAUDE_INSTANCE,
    }),
    providerThreadEvent({
      id: CODEX_PROVIDER_THREAD_ID,
      threadId: CODEX_THREAD_ID,
      driver: "codex",
      instance: CODEX_INSTANCE,
    }),
    providerTurnEvent("provider-turn:1", 1, "a3"),
    providerTurnEvent("provider-turn:2", 2, "a4"),
    ...messages.map((payload): OrchestrationV2DomainEvent => ({
      id: EventId.make(`event:seed:${payload.id}`),
      type: "message.updated",
      threadId: THREAD_ID,
      occurredAt: AT,
      payload,
    })),
    ...items.map((payload): OrchestrationV2DomainEvent => ({
      id: EventId.make(`event:seed:${payload.id}`),
      type: "turn-item.updated",
      threadId: THREAD_ID,
      ...(payload.runId === null ? {} : { runId: payload.runId }),
      occurredAt: AT,
      payload,
    })),
  ];
};

const makeLayer = (dirs: Dirs, fake: Fake) =>
  forkTranscriptEditLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        sinkLayer,
        ThreadCommandExecutor.layer,
        IdAllocator.layer,
        Layer.mock(ProviderSessionManagerV2)({
          isLive: () => Effect.sync(() => fake.live),
          releaseUnlessBusy: (input) =>
            Effect.sync(() => {
              fake.releaseCalls.push(input);
              return fake.released;
            }),
        }),
        Layer.mock(OrchestratorV2)({
          dispatch: (command) =>
            Effect.suspend(() => {
              fake.dispatched.push(command);
              return command.type === "thread.stop" ? fake.onStop : Effect.void;
            }).pipe(Effect.orDie, Effect.as({} as never)),
        }),
        Layer.mock(ServerConfig.ServerConfig)({ stateDir: dirs.stateDir } as never),
        ServerSettings.layerTest({
          providerInstances: {
            [CLAUDE_INSTANCE]: { driver: CLAUDE, config: { homePath: dirs.configDir } },
          },
        }),
      ),
    ),
  );

const setupDirs = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-transcript-edit-" });
  const configDir = path.join(root, "claude");
  const stateDir = path.join(root, "state");
  const filePath = path.join(configDir, "projects", "C--work", `${SESSION_ID}.jsonl`);
  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fs.makeDirectory(stateDir, { recursive: true });
  yield* fs.writeFileString(filePath, FIXTURE_TEXT);
  return { configDir, stateDir, filePath } satisfies Dirs;
});

type CaseContext = {
  readonly dirs: Dirs;
  readonly fake: Fake;
  readonly edit: ForkTranscriptEdit["Service"];
  readonly sink: EventSink.EventSinkV2["Service"];
  readonly projections: ProjectionStore.ProjectionStoreV2["Service"];
  readonly fs: FileSystem.FileSystem;
};

const runCase = <A, E>(
  body: (ctx: CaseContext) => Effect.Effect<A, E>,
  options: { readonly run2Status?: OrchestrationV2Run["status"] } = {},
) =>
  Effect.gen(function* () {
    const dirs = yield* setupDirs;
    const fs = yield* FileSystem.FileSystem;
    const fake: Fake = {
      live: true,
      released: true,
      releaseCalls: [],
      dispatched: [],
      onStop: Effect.void,
    };
    return yield* Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      yield* sink.write({ events: seedEvents(options.run2Status ?? "completed") });
      return yield* body({
        dirs,
        fake,
        sink,
        fs,
        edit: yield* ForkTranscriptEdit,
        projections: yield* ProjectionStore.ProjectionStoreV2,
      });
    }).pipe(Effect.provide(makeLayer(dirs, fake)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const pending = (op: ForkTranscriptPendingOp["op"]): ForkTranscriptPendingOp => ({
  op,
  at: "2026-11-25T11:00:00.000Z",
});

const saveInput = (baseKey: string, ops: ReadonlyArray<ForkTranscriptPendingOp["op"]>) => ({
  threadId: THREAD_ID,
  baseKey,
  ops: ops.map(pending),
  confirmStop: false,
  after: "idle" as const,
});

const readRecords = (projections: ProjectionStore.ProjectionStoreV2["Service"]) =>
  projections.getThreadRecords(THREAD_ID, [
    "turnItems",
    "messages",
    "providerThreads",
    "providerTurns",
  ]);

const itemText = (items: ReadonlyArray<OrchestrationV2TurnItem>, id: string) => {
  const item = items.find((candidate) => candidate.id === id);
  return item !== undefined && "text" in item ? item.text : null;
};

const messageText = (
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
  id: string,
): string | undefined => messages.find((candidate) => candidate.id === id)?.text;

const EDIT_A1 = { kind: "editAssistantText", uuid: "a1", block: 0, text: "UPDATED REPLY" } as const;
const DELETE_A3 = { kind: "deleteUnit", unit: "a3" } as const;

describe("ForkTranscriptEdit", () => {
  it.live("fails load on a Codex thread with not-claude", () =>
    runCase(({ edit }) =>
      Effect.gen(function* () {
        const error = yield* edit.load({ threadId: CODEX_THREAD_ID }).pipe(Effect.flip);
        assert.equal(error.code, "not-claude");
      }),
    ),
  );

  it.live("loads six units with no errors and links the a1 items to unit a1", () =>
    runCase(({ edit }) =>
      Effect.gen(function* () {
        const loaded = yield* edit.load({ threadId: THREAD_ID });
        assert.equal(loaded.sessionId, SESSION_ID);
        assert.deepEqual(
          loaded.units.map((unit) => unit.key),
          ["u1", "a1", "a2", "a3", "u2", "a4"],
        );
        assert.deepEqual(loaded.validation.errors, []);
        assert.deepEqual(loaded.live, { editable: true, reason: null, working: false });
        assert.deepInclude(loaded.links, { itemId: "item:a1", unitKey: "a1", inherited: false });
        assert.deepInclude(loaded.links, { itemId: "item:a1t", unitKey: "a1", inherited: false });
        assert.deepInclude(loaded.links, { itemId: "item:u2", unitKey: "u2", inherited: false });
        assert.isNull(loaded.compactionItemId);
      }),
    ),
  );

  it.live("loads a compacted file from its boundary and names the compaction item", () =>
    runCase(({ edit, fs, dirs, sink }) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(dirs.filePath, COMPACTED_FIXTURE_TEXT);
        yield* sink.write({
          events: [
            {
              id: EventId.make("event:seed:item:compact"),
              type: "turn-item.updated",
              threadId: THREAD_ID,
              runId: RUN_2,
              occurredAt: AT,
              payload: {
                ...itemBase("item:compact", RUN_2, "status-uuid", 2_000_009),
                type: "compaction",
                driver: CLAUDE,
              },
            },
          ],
        });
        const loaded = yield* edit.load({ threadId: THREAD_ID });
        assert.deepEqual(
          loaded.units.map((unit) => unit.key),
          ["b1", "s1", "u3", "a5"],
        );
        assert.equal(loaded.compactionItemId, "item:compact");
        assert.isFalse(loaded.links.some((link) => link.unitKey === "u1" || link.unitKey === "a1"));
      }),
    ),
  );

  it.live("previews ops on the cached base, reports a failed op, and returns block text", () =>
    runCase(({ edit }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        const preview = yield* edit.preview({
          threadId: THREAD_ID,
          baseKey,
          ops: [pending(DELETE_A3)],
        });
        assert.isNull(preview.failedAt);
        assert.deepEqual(
          preview.units.map((unit) => unit.key),
          ["u1", "a1", "a2", "u2", "a4"],
        );
        assert.deepInclude(
          preview.diff.map((item) => [item.key, item.status]),
          ["a3", "removed"],
        );
        const failed = yield* edit.preview({
          threadId: THREAD_ID,
          baseKey,
          ops: [pending({ kind: "deleteUnit", unit: "missing" })],
        });
        assert.equal(failed.failedAt?.index, 0);
        assert.equal(failed.units.length, 6);
        const text = yield* edit.blockText({
          threadId: THREAD_ID,
          baseKey,
          uuid: "a2",
          index: 0,
          part: "block",
        });
        assert.include(text, "ls");
        const stale = yield* edit
          .preview({ threadId: THREAD_ID, baseKey: "other-key", ops: [] })
          .pipe(Effect.flip);
        assert.equal(stale.code, "stale");
      }),
    ),
  );

  it.live("refuses a save with busy while a run works and confirmStop is false", () =>
    runCase(
      ({ edit, fake, fs, dirs }) =>
        Effect.gen(function* () {
          const loaded = yield* edit.load({ threadId: THREAD_ID });
          assert.deepEqual(loaded.live, { editable: true, reason: "working", working: true });
          const error = yield* edit.save(saveInput(loaded.baseKey, [DELETE_A3])).pipe(Effect.flip);
          assert.equal(error.code, "busy");
          assert.equal(yield* fs.readFileString(dirs.filePath), FIXTURE_TEXT);
          assert.deepEqual(yield* edit.backups({ threadId: THREAD_ID }), []);
          assert.deepEqual(fake.dispatched, []);
          assert.deepEqual(fake.releaseCalls, []);
        }),
      { run2Status: "running" },
    ),
  );

  it.live("refuses a save with busy when releaseUnlessBusy keeps the session", () =>
    runCase(({ edit, fake, fs, dirs }) =>
      Effect.gen(function* () {
        fake.released = false;
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        const error = yield* edit.save(saveInput(baseKey, [DELETE_A3])).pipe(Effect.flip);
        assert.equal(error.code, "busy");
        assert.equal(fake.releaseCalls.length, 1);
        assert.deepInclude(fake.releaseCalls[0] as object, {
          providerSessionId: PROVIDER_SESSION_ID,
          ownProviderThreadIds: [],
          throughRunOrdinal: 2,
          reason: "manual_shutdown",
        });
        assert.equal(yield* fs.readFileString(dirs.filePath), FIXTURE_TEXT);
      }),
    ),
  );

  it.live("refuses a save with stale after the file changed and keeps the file", () =>
    runCase(({ edit, fs, dirs }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        const appended = `${FIXTURE_TEXT}${JSON.stringify({
          type: "user",
          uuid: "x9",
          parentUuid: "a4",
          sessionId: "s-1",
          message: { role: "user", content: "late" },
        })}\n`;
        yield* fs.writeFileString(dirs.filePath, appended);
        const error = yield* edit.save(saveInput(baseKey, [DELETE_A3])).pipe(Effect.flip);
        assert.equal(error.code, "stale");
        assert.equal(yield* fs.readFileString(dirs.filePath), appended);
        assert.deepEqual(yield* edit.backups({ threadId: THREAD_ID }), []);
      }),
    ),
  );

  it.live("refuses a save with invalid or changed and writes nothing", () =>
    runCase(({ edit, fs, dirs }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        const invalid = yield* edit
          .save(
            saveInput(baseKey, [
              {
                kind: "insertMessage",
                role: "user",
                text: "dup",
                index: 1,
                uuid: "a1",
                timestamp: "2026-11-25T10:00:01.500Z",
                messageId: null,
              },
            ]),
          )
          .pipe(Effect.flip);
        assert.equal(invalid.code, "invalid");
        const changed = yield* edit
          .save(saveInput(baseKey, [{ kind: "deleteUnit", unit: "missing" }]))
          .pipe(Effect.flip);
        assert.equal(changed.code, "changed");
        assert.equal(yield* fs.readFileString(dirs.filePath), FIXTURE_TEXT);
        assert.deepEqual(yield* edit.backups({ threadId: THREAD_ID }), []);
      }),
    ),
  );

  it.live("saves an assistant text edit, makes one backup, and points the head at a4", () =>
    runCase(({ edit, fs, dirs, projections, fake }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        const saved = yield* edit.save(saveInput(baseKey, [EDIT_A1]));
        assert.isFalse(saved.stoppedTurn);
        assert.notEqual(saved.baseKey, baseKey);
        assert.equal(saved.unmappedUnits, 0);
        assert.include(yield* fs.readFileString(dirs.filePath), "UPDATED REPLY");
        const backups = yield* edit.backups({ threadId: THREAD_ID });
        assert.deepEqual(
          backups.map((backup) => [backup.name, backup.source]),
          [[saved.backup, "t3"]],
        );
        const after = yield* readRecords(projections);
        assert.equal(itemText(after.turnItems, "item:a1"), "UPDATED REPLY");
        assert.equal(messageText(after.messages, "msg:item:a1"), "UPDATED REPLY");
        assert.deepEqual(
          after.providerThreads.find((thread) => thread.id === PROVIDER_THREAD_ID)
            ?.nativeConversationHeadRef,
          { driver: CLAUDE, nativeId: "a4", strength: "weak" },
        );
        assert.equal(fake.releaseCalls.length, 1);
      }),
    ),
  );

  it.live("saves deleteUnit a3, hides its item, and remaps the a3 cursor to r1", () =>
    runCase(({ edit, projections }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        yield* edit.save(saveInput(baseKey, [DELETE_A3]));
        const after = yield* readRecords(projections);
        assert.isTrue(after.turnItems.find((i) => i.id === "item:a3")?.forkTranscriptHidden);
        assert.deepEqual(
          after.providerTurns
            .map((turn) => [turn.id, turn.nativeTurnRef?.nativeId])
            .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
          [
            ["provider-turn:1", "r1"],
            ["provider-turn:2", "a4"],
          ],
        );
      }),
    ),
  );

  it.live("saves an insert between its neighbors and reads the new order back", () =>
    runCase(({ edit, projections }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        yield* edit.save(
          saveInput(baseKey, [
            {
              kind: "insertMessage",
              role: "assistant",
              text: "inserted",
              index: 1,
              uuid: "n1",
              timestamp: "2026-11-25T10:00:01.500Z",
              messageId: null,
            },
          ]),
        );
        const after = yield* readRecords(projections);
        const ordered = after.turnItems.toSorted((a, b) => a.ordinal - b.ordinal);
        const inserted = ordered.find((item) => item.id.endsWith(":item:n1"));
        assert.isDefined(inserted);
        assert.deepEqual(
          ordered.map((item) => [item.id === inserted?.id ? "new" : item.id, item.ordinal]),
          [
            ["item:u1", 1_000_001],
            ["new", 1_000_002],
            ["item:a1t", 1_000_003],
            ["item:a1", 1_000_004],
            ["item:tool1", 1_000_005],
            ["item:a3", 1_000_006],
            ["item:u2", 2_000_001],
            ["item:a4", 2_000_002],
          ],
        );
        assert.equal(itemText(ordered, inserted?.id ?? ""), "inserted");
      }),
    ),
  );

  it.live("restores the backup of a save in the file and the projection", () =>
    runCase(({ edit, fs, dirs, projections }) =>
      Effect.gen(function* () {
        const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
        const saved = yield* edit.save(saveInput(baseKey, [EDIT_A1]));
        const restored = yield* edit.restore({
          threadId: THREAD_ID,
          baseKey: saved.baseKey,
          backup: saved.backup,
          source: "t3",
          confirmStop: false,
        });
        assert.equal(restored.baseKey, baseKey);
        assert.equal(yield* fs.readFileString(dirs.filePath), FIXTURE_TEXT);
        const after = yield* readRecords(projections);
        assert.equal(itemText(after.turnItems, "item:a1"), "reply one");
        assert.equal(messageText(after.messages, "msg:item:a1"), "reply one");
        assert.equal((yield* edit.backups({ threadId: THREAD_ID })).length, 2);
        yield* edit.deleteBackup({ threadId: THREAD_ID, backup: saved.backup, source: "t3" });
        assert.equal((yield* edit.backups({ threadId: THREAD_ID })).length, 1);
      }),
    ),
  );

  it.live("stops a working turn on confirmStop, saves, and sends the continue message", () =>
    runCase(
      ({ edit, fake, sink }) =>
        Effect.gen(function* () {
          fake.onStop = sink.write({
            events: [
              {
                id: EventId.make("event:stop:run2"),
                type: "run.updated",
                threadId: THREAD_ID,
                runId: RUN_2,
                occurredAt: AT,
                payload: run(RUN_2, 2, "interrupted"),
              },
            ],
          });
          const { baseKey } = yield* edit.load({ threadId: THREAD_ID });
          const saved = yield* edit.save({
            ...saveInput(baseKey, [DELETE_A3]),
            confirmStop: true,
            after: "continue",
          });
          assert.isTrue(saved.stoppedTurn);
          assert.deepEqual(
            fake.dispatched.map((command) => command.type),
            ["thread.stop", "message.dispatch"],
          );
          assert.deepInclude(fake.dispatched[0] as object, { scope: "turn", threadId: THREAD_ID });
          assert.deepInclude(fake.dispatched[1] as object, {
            text: CONTINUE_TEXT,
            dispatchMode: { type: "start_immediately" },
          });
        }),
      { run2Status: "running" },
    ),
  );
});
