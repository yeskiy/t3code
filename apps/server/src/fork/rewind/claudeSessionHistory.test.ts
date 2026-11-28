import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  claudeResumeBoundary,
  claudeSessionOfTurn,
  isOrphanClaudeErrorResult,
  needsFreshClaudeSession,
  withAbandonedClaudeSession,
  withReplacedClaudeSession,
  withRestoredClaudeSession,
} from "./claudeSessionHistory.ts";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const now = DateTime.makeUnsafe("2026-11-28T14:24:20Z");

const providerThread = (
  nativeId: string | null,
  nativeMetadata: OrchestrationV2ProviderThread["nativeMetadata"] = null,
  driver = CLAUDE,
): OrchestrationV2ProviderThread => ({
  id: ProviderThreadId.make("pt-serein"),
  driver,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  providerSessionId: null,
  appThreadId: null,
  ownerNodeId: null,
  nativeThreadRef: nativeId === null ? null : { driver, nativeId, strength: "strong" },
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

const turns = (...ordinals: ReadonlyArray<number>) =>
  ordinals.map((ordinal) => ({ providerThreadId: ProviderThreadId.make("pt-serein"), ordinal }));

describe("withReplacedClaudeSession", () => {
  it("records the replaced session with the turns it held, across two recoveries", () => {
    const afterFirst = withReplacedClaudeSession({
      previous: providerThread("A"),
      replacement: providerThread("B", { title: "serein" }),
      providerTurns: turns(1, 2, 30),
    });
    expect(afterFirst.nativeMetadata).toEqual({
      title: "serein",
      forkClaudeSessions: [{ sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 }],
    });
    const afterSecond = withReplacedClaudeSession({
      previous: afterFirst,
      replacement: providerThread("C"),
      providerTurns: turns(1, 2, 30, 31),
    });
    expect(afterSecond.nativeMetadata?.forkClaudeSessions).toEqual([
      { sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 },
      { sessionId: "B", firstTurnOrdinal: 31, lastTurnOrdinal: 31 },
    ]);
    expect(claudeSessionOfTurn(afterSecond, 30)).toBe("A");
    expect(claudeSessionOfTurn(afterSecond, 31)).toBe("B");
    expect(claudeSessionOfTurn(afterSecond, 32)).toBe("C");
  });

  it("skips a replaced session that held no turns and drops the fresh-session flag", () => {
    const replaced = withReplacedClaudeSession({
      previous: providerThread("F", {
        forkClaudeSessions: [{ sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 }],
        forkClaudeRecoverOnResume: true,
      }),
      replacement: providerThread("G", { forkClaudeRecoverOnResume: true }),
      providerTurns: turns(1, 30),
    });
    expect(replaced.nativeMetadata).toEqual({
      forkClaudeSessions: [{ sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 }],
    });
    expect(needsFreshClaudeSession(replaced)).toBe(false);
  });

  it("leaves other drivers and same-session replacements unchanged", () => {
    const codex = providerThread("B", null, ProviderDriverKind.make("codex"));
    expect(
      withReplacedClaudeSession({
        previous: providerThread("A", null, ProviderDriverKind.make("codex")),
        replacement: codex,
        providerTurns: turns(1),
      }),
    ).toBe(codex);
    const same = providerThread("A");
    expect(
      withReplacedClaudeSession({
        previous: providerThread("A"),
        replacement: same,
        providerTurns: turns(1),
      }),
    ).toBe(same);
  });
});

describe("claudeSessionOfTurn", () => {
  it("is unknown for a thread without a recorded session list", () => {
    expect(claudeSessionOfTurn(providerThread("C"), 30)).toBeUndefined();
  });
});

describe("withRestoredClaudeSession", () => {
  it("makes an older session current and forgets the sessions after it", () => {
    const restored = withRestoredClaudeSession(
      providerThread("C", {
        forkClaudeSessions: [
          { sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 },
          { sessionId: "B", firstTurnOrdinal: 31, lastTurnOrdinal: 31 },
        ],
      }),
      "A",
    );
    expect(restored.nativeThreadRef?.nativeId).toBe("A");
    expect(restored.nativeMetadata?.forkClaudeSessions).toEqual([]);
    expect(claudeSessionOfTurn(restored, 30)).toBe("A");
  });
});

describe("withAbandonedClaudeSession", () => {
  it("records the current session, moves to a fresh one, and marks the next resume", () => {
    const abandoned = withAbandonedClaudeSession({
      providerThread: providerThread("C", {
        forkClaudeSessions: [{ sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 }],
      }),
      freshSessionId: "F",
      providerTurns: turns(1, 30, 31),
    });
    expect(abandoned.nativeThreadRef?.nativeId).toBe("F");
    expect(abandoned.nativeConversationHeadRef).toBeNull();
    expect(needsFreshClaudeSession(abandoned)).toBe(true);
    expect(abandoned.nativeMetadata?.forkClaudeSessions).toEqual([
      { sessionId: "A", firstTurnOrdinal: 1, lastTurnOrdinal: 30 },
      { sessionId: "C", firstTurnOrdinal: 31, lastTurnOrdinal: 31 },
    ]);
  });
});

describe("isOrphanClaudeErrorResult", () => {
  it("matches only an error result with no buffered frame before it", () => {
    expect(isOrphanClaudeErrorResult({ type: "result", is_error: true }, 0)).toBe(true);
    expect(isOrphanClaudeErrorResult({ type: "result", is_error: true }, 1)).toBe(false);
    expect(isOrphanClaudeErrorResult({ type: "result", is_error: false }, 0)).toBe(false);
    expect(isOrphanClaudeErrorResult({ type: "assistant" }, 0)).toBe(false);
  });
});

describe("claudeResumeBoundary", () => {
  const messages = [{ uuid: "u1" }, { uuid: "a1" }, { uuid: "u2" }];
  it("ends after the resume point, or at the end without one", () => {
    expect(claudeResumeBoundary(messages, "a1")).toBe(2);
    expect(claudeResumeBoundary(messages, undefined)).toBe(3);
  });
  it("is null when the transcript does not hold the resume point", () => {
    expect(claudeResumeBoundary(messages, "77154793")).toBeNull();
  });
});
