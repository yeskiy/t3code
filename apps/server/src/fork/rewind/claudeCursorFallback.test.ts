import { describe, expect, it } from "vite-plus/test";

import { nearestEarlierClaudeCursor } from "./claudeCursorFallback.ts";

const turn = (ordinal: number, cursor: string | null, providerThreadId = "pt-1") => ({
  ordinal,
  providerThreadId,
  cursor,
});
const cursorOf = (entry: { readonly cursor: string | null }) => entry.cursor;

describe("nearestEarlierClaudeCursor", () => {
  it("returns the newest earlier real cursor and counts the dropped turns", () => {
    const turns = [turn(1, "a1"), turn(2, "a2"), turn(3, null), turn(4, null), turn(5, "a5")];
    expect(
      nearestEarlierClaudeCursor({ targetTurn: turns[3]!, providerThreadTurns: turns, cursorOf }),
    ).toEqual({ cursor: "a2", droppedTurns: 2 });
  });

  it("ignores turns of another provider thread and later turns", () => {
    const turns = [turn(1, "x1", "pt-2"), turn(2, null), turn(3, "a3")];
    expect(
      nearestEarlierClaudeCursor({ targetTurn: turns[1]!, providerThreadTurns: turns, cursorOf }),
    ).toBeNull();
  });

  it("counts only retained turns of the provider thread across ordinal gaps", () => {
    const turns = [turn(1, "a1"), turn(5, null)];
    expect(
      nearestEarlierClaudeCursor({ targetTurn: turns[1]!, providerThreadTurns: turns, cursorOf }),
    ).toEqual({ cursor: "a1", droppedTurns: 1 });
  });
});
