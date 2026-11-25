import { describe, expect, it } from "vite-plus/test";

import { withoutForkHiddenItems } from "./hiddenItems.logic";

type Entry = { readonly item: { readonly id: string; readonly forkTranscriptHidden?: true } };

describe("hiddenItems.logic", () => {
  it("drops hidden items while keeping order and identity of the others", () => {
    const keep1: Entry = { item: { id: "i1" } };
    const hidden: Entry = { item: { id: "i2", forkTranscriptHidden: true } };
    const keep2: Entry = { item: { id: "i3" } };

    const result = withoutForkHiddenItems([keep1, hidden, keep2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(keep1);
    expect(result[1]).toBe(keep2);
  });

  it("returns the exact same array reference when nothing is hidden", () => {
    const items: ReadonlyArray<Entry> = [{ item: { id: "i1" } }, { item: { id: "i2" } }];
    expect(withoutForkHiddenItems(items)).toBe(items);
  });
});
