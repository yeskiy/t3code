import { describe, expect, it } from "vite-plus/test";

import {
  emptySelection,
  extendSelection,
  paintSelection,
  pruneSelection,
  rangeSelect,
  rangeSelectKeys,
  selectAll,
  toggleKeys,
  toggleSelect,
} from "./selection.logic";

const order = ["u1", "a1", "a2", "a3", "u2"] as const;

describe("selection.logic", () => {
  it("toggleSelect adds and removes a key and sets the anchor", () => {
    const s1 = toggleSelect(emptySelection, "u1");
    expect([...s1.keys]).toEqual(["u1"]);
    expect(s1.anchor).toBe("u1");

    const s2 = toggleSelect(s1, "a2");
    expect([...s2.keys]).toEqual(["u1", "a2"]);
    expect(s2.anchor).toBe("a2");

    const s3 = toggleSelect(s2, "u1");
    expect([...s3.keys]).toEqual(["a2"]);
    expect(s3.anchor).toBe("u1");
  });

  it("rangeSelect from anchor u1 to a3 selects u1, a1, a2, a3", () => {
    const start = toggleSelect(emptySelection, "u1");
    const ranged = rangeSelect(start, "a3", order);

    expect([...ranged.keys]).toEqual(["u1", "a1", "a2", "a3"]);
    expect(ranged.anchor).toBe("u1");

    // Works in reverse order too.
    const reverseStart = toggleSelect(emptySelection, "a3");
    const reverseRanged = rangeSelect(reverseStart, "u1", order);
    expect([...reverseRanged.keys]).toEqual(["u1", "a1", "a2", "a3"]);
    expect(reverseRanged.anchor).toBe("a3");
  });

  it("extendSelection down twice from a1 adds a2 and a3", () => {
    const start = toggleSelect(emptySelection, "a1");
    const step1 = extendSelection(start, 1, order);
    expect([...step1.keys]).toEqual(["a1", "a2"]);
    expect(step1.anchor).toBe("a1");

    const step2 = extendSelection(step1, 1, order);
    expect([...step2.keys]).toEqual(["a1", "a2", "a3"]);
    expect(step2.anchor).toBe("a1");

    // Stepping back up shrinks the range toward the anchor.
    const back = extendSelection(step2, -1, order);
    expect([...back.keys]).toEqual(["a1", "a2"]);
    expect(back.anchor).toBe("a1");
  });

  it("extendSelection from empty selects the first unit", () => {
    const s = extendSelection(emptySelection, 1, order);
    expect([...s.keys]).toEqual(["u1"]);
    expect(s.anchor).toBe("u1");
  });

  it("selectAll selects every key and anchors on the first", () => {
    const all = selectAll(order);
    expect([...all.keys]).toEqual([...order]);
    expect(all.anchor).toBe("u1");

    expect(selectAll([])).toEqual({ keys: new Set(), anchor: null });
  });

  it("pruneSelection drops keys that are no longer in the order", () => {
    const initial = rangeSelect(toggleSelect(emptySelection, "a1"), "a3", order);
    const pruned = pruneSelection(initial, ["u1", "a2", "u2"]);

    expect([...pruned.keys]).toEqual(["a2"]);
    expect(pruned.anchor).toBeNull();

    const keptAnchor = pruneSelection(toggleSelect(emptySelection, "a2"), ["u1", "a2"]);
    expect([...keptAnchor.keys]).toEqual(["a2"]);
    expect(keptAnchor.anchor).toBe("a2");
  });

  it("toggleKeys selects a whole row unless every unit of it is selected", () => {
    const some = toggleKeys(toggleSelect(emptySelection, "a2"), ["a1", "a2"]);
    expect([...some.keys].toSorted()).toEqual(["a1", "a2"]);
    expect(some.anchor).toBe("a1");

    const none = toggleKeys(some, ["a1", "a2"]);
    expect([...none.keys]).toEqual([]);
    expect(none.anchor).toBe("a1");
  });

  it("rangeSelectKeys covers the anchor and every unit of the target row", () => {
    const down = rangeSelectKeys(toggleSelect(emptySelection, "u1"), ["a2", "a3"], order);
    expect([...down.keys]).toEqual(["u1", "a1", "a2", "a3"]);
    expect(down.anchor).toBe("u1");

    const up = rangeSelectKeys(toggleSelect(emptySelection, "a3"), ["u1", "a1"], order);
    expect([...up.keys].toSorted()).toEqual(["a1", "a2", "a3", "u1"]);

    const fresh = rangeSelectKeys(emptySelection, ["a1", "a2"], order);
    expect([...fresh.keys]).toEqual(["a1", "a2"]);
    expect(fresh.anchor).toBe("a1");
  });

  it("paintSelection adds or removes the rows between the start and the pointer", () => {
    const base = toggleSelect(emptySelection, "u2");
    const added = paintSelection(base, ["a1"], ["a3"], order, "add");
    expect([...added.keys].toSorted()).toEqual(["a1", "a2", "a3", "u2"]);
    expect(added.anchor).toBe("a1");

    const removed = paintSelection(selectAll(order), ["a3"], ["a1"], order, "remove");
    expect([...removed.keys]).toEqual(["u1", "u2"]);
  });
});
