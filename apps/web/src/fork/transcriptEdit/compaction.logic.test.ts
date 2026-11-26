import { describe, expect, it } from "vite-plus/test";

import { compactionCutoff } from "./compaction.logic";

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
