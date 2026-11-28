import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  makeClaudeTranscriptLookup,
  placeClaudeRewind,
  type ClaudeTranscriptLookup,
} from "./claudeSessionRewind.ts";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const now = DateTime.makeUnsafe("2026-11-28T14:24:20Z");
const PT = ProviderThreadId.make("pt-serein");

const providerThread = (
  nativeId: string,
  nativeMetadata: OrchestrationV2ProviderThread["nativeMetadata"] = null,
): OrchestrationV2ProviderThread => ({
  id: PT,
  driver: CLAUDE,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  providerSessionId: null,
  appThreadId: null,
  ownerNodeId: null,
  nativeThreadRef: { driver: CLAUDE, nativeId, strength: "strong" },
  nativeConversationHeadRef: null,
  status: "idle",
  firstRunOrdinal: null,
  lastRunOrdinal: null,
  handoffIds: [],
  forkedFrom: null,
  pendingBackgroundTasks: [],
  contextUsage: null,
  nativeMetadata,
  goal: null,
  createdAt: now,
  updatedAt: now,
});

interface Turn {
  readonly providerThreadId: string;
  readonly ordinal: number;
  readonly cursor: string | null;
}
const turn = (ordinal: number, cursor: string | null): Turn => ({
  providerThreadId: PT,
  ordinal,
  cursor,
});
const cursorOf = (entry: Turn) => entry.cursor;

// Serein: A holds turns 1-30, B (empty) holds 31, C holds 32.
const SEREIN_TURNS = [turn(29, "a29"), turn(30, "a30"), turn(31, null), turn(32, "c32")];
const transcripts: Record<string, ReadonlyArray<string>> = { A: ["a29", "a30"], B: [], C: ["c32"] };
const fakeLookup = (
  files: Record<string, ReadonlyArray<string>> | null,
): ClaudeTranscriptLookup => ({
  holds: (sessionId, messageId) =>
    Effect.succeed(files === null ? undefined : files[sessionId]?.includes(messageId)),
  find: (besideSessionId, messageId) =>
    Effect.succeed(
      files === null
        ? undefined
        : Object.entries(files).find(
            ([sessionId, ids]) => sessionId !== besideSessionId && ids.includes(messageId),
          )?.[0],
    ),
});

const place = (input: {
  readonly thread: OrchestrationV2ProviderThread;
  readonly target: Turn;
  readonly cursor: string | null;
  readonly fellBack?: boolean;
  readonly files?: Record<string, ReadonlyArray<string>> | null;
}) =>
  placeClaudeRewind({
    providerThread: input.thread,
    targetTurn: input.target,
    cursor: input.cursor,
    fellBack: input.fellBack ?? false,
    providerThreadTurns: SEREIN_TURNS,
    cursorOf,
    lookup: fakeLookup(input.files === undefined ? transcripts : input.files),
  });

const RECORDED = {
  forkClaudeSessions: [
    { sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 },
    { sessionId: "B", firstTurnOrdinal: 31, lastTurnOrdinal: 31 },
  ],
};

describe("placeClaudeRewind with a recorded session list", () => {
  it.effect("resumes the older session that holds the target cursor", () =>
    Effect.gen(function* () {
      expect(
        yield* place({
          thread: providerThread("C", RECORDED),
          target: SEREIN_TURNS[1]!,
          cursor: "a30",
        }),
      ).toEqual({ kind: "session", sessionId: "A" });
    }),
  );

  it.effect("keeps the current session for a cursor it holds", () =>
    Effect.gen(function* () {
      expect(
        yield* place({
          thread: providerThread("C", RECORDED),
          target: SEREIN_TURNS[3]!,
          cursor: "c32",
        }),
      ).toEqual({ kind: "current" });
    }),
  );

  it.effect("starts fresh when the older session transcript lost the cursor", () =>
    Effect.gen(function* () {
      expect(
        yield* place({
          thread: providerThread("C", RECORDED),
          target: SEREIN_TURNS[1]!,
          cursor: "a30",
          files: { ...transcripts, A: [] },
        }),
      ).toEqual({ kind: "fresh" });
    }),
  );
});

describe("placeClaudeRewind for a thread that recovered before the session list", () => {
  it.effect("finds the older session file that holds the target cursor", () =>
    Effect.gen(function* () {
      expect(
        yield* place({ thread: providerThread("C"), target: SEREIN_TURNS[1]!, cursor: "a30" }),
      ).toEqual({ kind: "session", sessionId: "A" });
    }),
  );

  it.effect("refuses an earlier cursor from before a session boundary", () =>
    Effect.gen(function* () {
      expect(
        yield* place({
          thread: providerThread("C"),
          target: SEREIN_TURNS[2]!,
          cursor: "a30",
          fellBack: true,
        }),
      ).toEqual({ kind: "fresh" });
    }),
  );

  it.effect("keeps today's behavior when no transcript is readable", () =>
    Effect.gen(function* () {
      expect(
        yield* place({
          thread: providerThread("C"),
          target: SEREIN_TURNS[1]!,
          cursor: "a30",
          files: null,
        }),
      ).toEqual({ kind: "current" });
    }),
  );

  it.effect("starts fresh when no session file holds the cursor", () =>
    Effect.gen(function* () {
      expect(
        yield* place({
          thread: providerThread("C"),
          target: SEREIN_TURNS[1]!,
          cursor: "a30",
          files: { ...transcripts, A: [] },
        }),
      ).toEqual({ kind: "fresh" });
    }),
  );
});

describe("makeClaudeTranscriptLookup", () => {
  it.effect("reads which session transcript holds a message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectsDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-rewind-" });
        const projectDir = path.join(projectsDir, "-workspace");
        yield* fileSystem.makeDirectory(projectDir, { recursive: true });
        const line = (type: string, uuid: string) => JSON.stringify({ type, uuid, sessionId: "x" });
        yield* fileSystem.writeFileString(
          path.join(projectDir, "A.jsonl"),
          [line("user", "a1"), line("assistant", "a30"), ""].join("\n"),
        );
        yield* fileSystem.writeFileString(
          path.join(projectDir, "C.jsonl"),
          [line("user", "c31"), line("progress", "a30"), ""].join("\n"),
        );
        const lookup = makeClaudeTranscriptLookup({
          fileSystem,
          path,
          projectsDir: Effect.succeed(projectsDir),
        });
        expect(yield* lookup.holds("A", "a30")).toBe(true);
        expect(yield* lookup.holds("C", "a30")).toBe(false);
        expect(yield* lookup.holds("missing", "a30")).toBeUndefined();
        expect(yield* lookup.find("C", "a30")).toBe("A");
        expect(yield* lookup.find("C", "nothing")).toBeUndefined();
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
