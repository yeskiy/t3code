import type {
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  claudeSessionOfTurn,
  withAbandonedClaudeSession,
  withRestoredClaudeSession,
} from "./claudeSessionHistory.ts";

export interface ClaudeTranscriptLookup {
  // True or false when a transcript of the session was read, undefined when none was readable.
  readonly holds: (sessionId: string, messageId: string) => Effect.Effect<boolean | undefined>;
  // Another session beside the given one whose transcript holds the message.
  readonly find: (besideSessionId: string, messageId: string) => Effect.Effect<string | undefined>;
}

export type ClaudeRewindPlacement =
  | { readonly kind: "current" }
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "fresh" };

const decodeConversationLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ type: Schema.Literals(["user", "assistant"]), uuid: Schema.String }),
  ),
);

const TRANSCRIPT_SUFFIX = ".jsonl";

export const makeClaudeTranscriptLookup = <E>(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly projectsDir: Effect.Effect<string, E>;
}): ClaudeTranscriptLookup => {
  const { fileSystem, path } = input;
  const fileHolds = (file: string, messageId: string) =>
    fileSystem.stream(file).pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.filter(
        (line) =>
          line.includes(messageId) &&
          Option.exists(decodeConversationLine(line), (entry) => entry.uuid === messageId),
      ),
      Stream.runHead,
      Effect.map(Option.isSome),
      Effect.option,
    );
  const sessionFiles = Effect.fn("ClaudeTranscriptLookup.sessionFiles")(
    function* (sessionId: string) {
      const projectsDir = yield* input.projectsDir;
      const files = (yield* fileSystem.readDirectory(projectsDir)).map((project) =>
        path.join(projectsDir, project, `${sessionId}${TRANSCRIPT_SUFFIX}`),
      );
      return yield* Effect.filter(files, (file) =>
        fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false)),
      );
    },
    (effect) => Effect.orElseSucceed(effect, (): ReadonlyArray<string> => []),
  );
  const holds = Effect.fn("ClaudeTranscriptLookup.holds")(function* (
    sessionId: string,
    messageId: string,
  ) {
    const reads = yield* Effect.forEach(yield* sessionFiles(sessionId), (file) =>
      fileHolds(file, messageId),
    );
    if (reads.some((read) => Option.isSome(read) && read.value)) return true;
    return reads.some(Option.isSome) ? false : undefined;
  });
  // Searches only the project folders that hold the given session, as one thread stays in one folder.
  const find = Effect.fn("ClaudeTranscriptLookup.find")(function* (
    besideSessionId: string,
    messageId: string,
  ) {
    const candidates = (yield* Effect.forEach(yield* sessionFiles(besideSessionId), (file) =>
      fileSystem.readDirectory(path.dirname(file)).pipe(
        Effect.map((names) =>
          names
            .filter((name) => name.endsWith(TRANSCRIPT_SUFFIX) && name !== path.basename(file))
            .map((name) => path.join(path.dirname(file), name)),
        ),
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
      ),
    )).flat();
    const found = yield* Effect.findFirst(candidates, (file) =>
      fileHolds(file, messageId).pipe(Effect.map((read) => Option.isSome(read) && read.value)),
    );
    return Option.getOrUndefined(
      Option.map(found, (file) => path.basename(file, TRANSCRIPT_SUFFIX)),
    );
  });
  return { holds, find };
};

// Picks the Claude session for a rewind cursor. It never resumes a session that lacks the cursor.
export const placeClaudeRewind = Effect.fn("ClaudeRewind.placeSession")(function* <
  T extends { readonly ordinal: number },
>(input: {
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly targetTurn: T;
  readonly cursor: string | null;
  readonly fellBack: boolean;
  readonly providerThreadTurns: ReadonlyArray<T>;
  readonly cursorOf: (turn: T) => string | null;
  readonly lookup: ClaudeTranscriptLookup;
}) {
  const current = input.providerThread.nativeThreadRef?.nativeId ?? null;
  const cursor = input.cursor;
  if (cursor === null || current === null) return { kind: "current" } as ClaudeRewindPlacement;
  const sessionOf = (turn: T) => claudeSessionOfTurn(input.providerThread, turn.ordinal);
  const cursorTurn =
    input.providerThreadTurns.find((turn) => input.cursorOf(turn) === cursor) ?? input.targetTurn;
  const recorded = sessionOf(cursorTurn);
  const restore = (sessionId: string | undefined) =>
    Effect.map(
      sessionId === undefined ? Effect.succeed(false) : input.lookup.holds(sessionId, cursor),
      (holds): ClaudeRewindPlacement =>
        holds === true && sessionId !== undefined
          ? { kind: "session", sessionId }
          : { kind: "fresh" },
    );
  if (recorded !== undefined) {
    return recorded === current ? ({ kind: "current" } as const) : yield* restore(recorded);
  }
  // No session list: an unreadable current transcript leaves the resume as it was.
  if ((yield* input.lookup.holds(current, cursor)) !== false) return { kind: "current" } as const;
  const found = yield* input.lookup.find(current, cursor);
  if (found === undefined || !input.fellBack) return yield* restore(found);
  // The target has no cursor of its own, so its session is known only when both neighbors share one.
  const later = input.providerThreadTurns
    .filter((turn) => turn.ordinal > input.targetTurn.ordinal && input.cursorOf(turn) !== null)
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .at(0);
  const laterCursor = later === undefined ? null : input.cursorOf(later);
  const laterSession =
    laterCursor === null || (yield* input.lookup.holds(current, laterCursor)) !== false
      ? current
      : yield* input.lookup.find(current, laterCursor);
  return laterSession === found ? yield* restore(found) : ({ kind: "fresh" } as const);
});

// Moves a rolled-back Claude thread into the session that holds its rewind cursor.
export const placeClaudeRollback = Effect.fn("ClaudeRewind.placeRollback")(function* <E>(input: {
  readonly rollbackInput: ProviderAdapter.ProviderAdapterV2RollbackThreadInput;
  readonly resolved: {
    readonly cursor: string | null;
    readonly droppedTurns: number | undefined;
    readonly forkFreshSession?: true;
  };
  readonly cursorOf: (turn: OrchestrationV2ProviderTurn) => string | null;
  readonly lookup: ClaudeTranscriptLookup;
  readonly allocateSessionId: Effect.Effect<string, E>;
}) {
  const { rollbackInput, resolved } = input;
  const unchanged = {
    droppedTurns: resolved.droppedTurns,
    place: (thread: OrchestrationV2ProviderThread) => thread,
  };
  if (
    rollbackInput.forkEarlierCursorFallback !== true ||
    rollbackInput.target.type !== "provider_turn"
  ) {
    return unchanged;
  }
  const placement: ClaudeRewindPlacement =
    resolved.forkFreshSession === true
      ? { kind: "fresh" }
      : yield* placeClaudeRewind({
          providerThread: rollbackInput.providerThread,
          targetTurn: rollbackInput.target.providerTurn,
          cursor: resolved.cursor,
          fellBack: resolved.droppedTurns !== undefined,
          providerThreadTurns: rollbackInput.providerThreadTurns,
          cursorOf: input.cursorOf,
          lookup: input.lookup,
        });
  if (placement.kind === "current") return unchanged;
  yield* Effect.logInfo("Claude rollback moved to another session", {
    providerThreadId: rollbackInput.providerThread.id,
    from: rollbackInput.providerThread.nativeThreadRef?.nativeId ?? null,
    placement: placement.kind === "session" ? placement.sessionId : "fresh",
  });
  if (placement.kind === "session") {
    return {
      droppedTurns: resolved.droppedTurns,
      place: (thread: OrchestrationV2ProviderThread) =>
        withRestoredClaudeSession(thread, placement.sessionId),
    };
  }
  const freshSessionId = yield* input.allocateSessionId;
  return {
    droppedTurns: undefined,
    place: (thread: OrchestrationV2ProviderThread) =>
      withAbandonedClaudeSession({
        providerThread: thread,
        freshSessionId,
        providerTurns: rollbackInput.providerThreadTurns,
      }),
  };
});
