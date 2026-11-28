import { describe, expect, it } from "vite-plus/test";

import {
  compactionCutoff,
  earlierSessionCut,
  earlierSessionTurnIds,
  rowCut,
} from "./compaction.logic";

const row = (
  position: number,
  type: string,
  extra: { status?: string; driver?: string | null; forkTranscriptHidden?: true } = {},
) => ({
  position,
  item: { id: `item:${position}`, type, status: extra.status ?? "completed", ...extra },
});

const ROWS = [
  row(0, "user_message"),
  row(1, "compaction", { driver: "claudeAgent" }),
  row(2, "assistant_message"),
  row(3, "compaction", { driver: "claudeAgent" }),
  row(4, "compaction", { driver: "claudeAgent", status: "failed" }),
  row(5, "compaction", { driver: "codex" }),
  row(6, "compaction", { driver: "claudeAgent", forkTranscriptHidden: true }),
  row(7, "user_message"),
];

describe("compactionCutoff", () => {
  it("uses the last completed Claude compaction before the first load", () => {
    expect(compactionCutoff(ROWS, undefined)).toBe(3);
  });

  it("uses the server compaction item after the load", () => {
    expect(compactionCutoff(ROWS, "item:1")).toBe(1);
  });

  it("gives null when the server finds no compaction on the active path", () => {
    expect(compactionCutoff(ROWS, null)).toBeNull();
  });

  it("gives null for an unknown server item and for a thread without compaction", () => {
    expect(compactionCutoff(ROWS, "item:missing")).toBeNull();
    expect(compactionCutoff([row(0, "user_message")], undefined)).toBeNull();
  });
});

const turnRow = (position: number, providerTurnId: string | null) => ({
  position,
  item: { id: `item:${position}`, type: "command_execution", status: "completed", providerTurnId },
});

const projection = (spans?: ReadonlyArray<{ readonly lastTurnOrdinal: number }>) => ({
  thread: { activeProviderThreadId: "pt-1" },
  providerThreads: [
    {
      id: "pt-1",
      nativeMetadata: spans === undefined ? null : { forkClaudeSessions: spans },
    },
  ],
  providerTurns: [
    { id: "turn-1", providerThreadId: "pt-1", ordinal: 1 },
    { id: "turn-2", providerThreadId: "pt-1", ordinal: 2 },
    { id: "turn-3", providerThreadId: "pt-1", ordinal: 3 },
    { id: "other-1", providerThreadId: "pt-2", ordinal: 1 },
  ],
});

const TURN_ROWS = [
  turnRow(0, null),
  turnRow(1, "turn-1"),
  turnRow(2, null),
  turnRow(3, "turn-2"),
  turnRow(4, null),
  turnRow(5, "turn-3"),
];

describe("earlierSessionTurnIds", () => {
  it("gives the turns up to the last recorded earlier session of the active thread", () => {
    const value = projection([{ lastTurnOrdinal: 1 }, { lastTurnOrdinal: 2 }]);
    expect([...earlierSessionTurnIds(value)]).toEqual(["turn-1", "turn-2"]);
    expect(earlierSessionTurnIds(value)).toBe(earlierSessionTurnIds(value));
  });

  it("gives no turns when the thread has no session list", () => {
    expect(earlierSessionTurnIds(projection()).size).toBe(0);
  });
});

describe("earlierSessionCut", () => {
  const ids = new Set(["turn-1", "turn-2"]);

  it("uses the last row of an earlier turn before the first load", () => {
    expect(earlierSessionCut(TURN_ROWS, ids, undefined)).toBe(3);
    expect(earlierSessionCut(TURN_ROWS, new Set(), undefined)).toBeNull();
  });

  it("uses the server item after the load", () => {
    expect(earlierSessionCut(TURN_ROWS, ids, "item:1")).toBe(1);
    expect(earlierSessionCut(TURN_ROWS, ids, null)).toBeNull();
    expect(earlierSessionCut(TURN_ROWS, ids, "item:missing")).toBeNull();
  });
});

describe("rowCut", () => {
  it("marks rows up to the earlier-session cut before rows before the compaction", () => {
    const cuts = { compaction: 6, earlierSession: 3 };
    expect([2, 3, 4, 6].map((position) => rowCut(position, cuts))).toEqual([
      "earlier-session",
      "earlier-session",
      "before-compaction",
      null,
    ]);
    expect(rowCut(0, { compaction: null, earlierSession: null })).toBeNull();
  });
});
