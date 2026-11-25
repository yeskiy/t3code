import { describe, expect, it } from "@effect/vitest";

import { forkVisibleTurnItems } from "./visibleItems.ts";

type TestItem = { readonly id: string; readonly forkTranscriptHidden?: true };

describe("forkVisibleTurnItems", () => {
  it("drops hidden items and keeps the order of the others", () => {
    const first: TestItem = { id: "a" };
    const hidden: TestItem = { id: "b", forkTranscriptHidden: true };
    const third: TestItem = { id: "c" };
    const hiddenSecond: TestItem = { id: "d", forkTranscriptHidden: true };
    const fifth: TestItem = { id: "e" };

    expect(forkVisibleTurnItems([first, hidden, third, hiddenSecond, fifth])).toEqual([
      first,
      third,
      fifth,
    ]);
  });

  it("keeps all items when none are hidden", () => {
    const items: ReadonlyArray<TestItem> = [{ id: "a" }, { id: "b" }];
    expect(forkVisibleTurnItems(items)).toEqual(items);
  });

  it("returns an empty array for empty or all-hidden input", () => {
    expect(forkVisibleTurnItems<TestItem>([])).toEqual([]);
    expect(forkVisibleTurnItems<TestItem>([{ id: "x", forkTranscriptHidden: true }])).toEqual([]);
  });
});
