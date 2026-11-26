import type {
  ForkTranscriptOp,
  ForkTranscriptUnitView,
  ForkTranscriptViewBlock,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  bulkDeleteStep,
  bulkMoveStep,
  bulkRemoveThinkingStep,
  deleteSelection,
  dropAfterKey,
  selectableUnitKeys,
} from "./bulkSteps.logic";
import type { Step } from "./history.logic";
import type { Selection } from "./selection.logic";

const block = (
  uuid: string,
  index: number,
  type: ForkTranscriptViewBlock["type"],
): ForkTranscriptViewBlock => ({
  uuid,
  index,
  type,
  text: type,
  truncated: false,
  editable: type === "text",
  removable: type === "thinking" || type === "redacted_thinking",
});

const unit = (
  key: string,
  kind: ForkTranscriptUnitView["kind"],
  options: {
    readonly locked?: boolean;
    readonly blocks?: ReadonlyArray<ForkTranscriptViewBlock>;
  } = {},
): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: options.locked ?? false,
  meta: false,
  compactSummary: false,
  time: null,
  blocks: options.blocks ?? [block(key, 0, "text")],
  entries: [],
  hidden: [],
  excerpt: key,
});

const UNITS = [
  unit("pre", "preamble", { locked: true }),
  unit("u1", "user"),
  unit("a1", "assistant"),
  unit("a1t", "assistant", {
    blocks: [block("a1t-e1", 0, "thinking"), block("a1t-e2", 0, "text")],
  }),
  unit("a2", "assistant"),
  unit("a3", "assistant"),
  unit("u2", "user"),
];
const ORDER = UNITS.map((item) => item.key);

// Applies moveUnit ops with the core rule: take the unit out, then insert it at toIndex.
const applyMoves = (order: ReadonlyArray<string>, step: Omit<Step, "id">) =>
  step.items.reduce<ReadonlyArray<string>>((current, { op }) => {
    if (op.kind !== "moveUnit") throw new Error(`Unexpected op ${op.kind}`);
    const rest = current.filter((key) => key !== op.unit);
    if (op.toIndex >= current.length) throw new Error("The target index is out of range.");
    return [...rest.slice(0, op.toIndex), op.unit, ...rest.slice(op.toIndex)];
  }, order);

const ops = (step: Omit<Step, "id"> | null): ReadonlyArray<ForkTranscriptOp> =>
  step?.items.map((item) => item.op) ?? [];

describe("bulkSteps.logic", () => {
  it("deletes a2 and a3 in one step with one deleteUnits op", () => {
    const step = bulkDeleteStep(UNITS, new Set(["a3", "a2"]));

    expect(step?.label).toBe("Deleted 2 messages");
    expect(step?.unitKeys).toEqual(["a2", "a3"]);
    expect(ops(step)).toEqual([{ kind: "deleteUnits", units: ["a2", "a3"] }]);
  });

  it("names a single delete and skips locked and unknown keys", () => {
    expect(bulkDeleteStep(UNITS, new Set(["a1", "pre", "gone"]))?.label).toBe("Deleted message");
    expect(bulkDeleteStep(UNITS, new Set(["pre"]))).toBeNull();
  });

  it("moves a1 and a2 down and keeps a1 before a2", () => {
    const step = bulkMoveStep(UNITS, new Set(["a1", "a2"]), { direction: 1 });

    expect(step?.label).toBe("Moved 2 messages");
    expect(ops(step).every((op) => op.kind === "moveUnit")).toBe(true);
    expect(applyMoves(ORDER, step!)).toEqual(["pre", "u1", "a1t", "a1", "a3", "a2", "u2"]);
  });

  it("moves a contiguous block down past its next neighbor", () => {
    const step = bulkMoveStep(UNITS, new Set(["a1", "a1t"]), { direction: 1 });

    expect(applyMoves(ORDER, step!)).toEqual(["pre", "u1", "a2", "a1", "a1t", "a3", "u2"]);
  });

  it("moves a selection up and stops at the leading locked unit", () => {
    const step = bulkMoveStep(UNITS, new Set(["u1", "a2"]), { direction: -1 });

    expect(step?.label).toBe("Moved 2 messages");
    expect(applyMoves(ORDER, step!)).toEqual(["pre", "u1", "a1", "a2", "a1t", "a3", "u2"]);
    expect(bulkMoveStep(UNITS, new Set(["u1"]), { direction: -1 })).toBeNull();
    expect(bulkMoveStep(UNITS, new Set(["u2"]), { direction: 1 })).toBeNull();
  });

  it("moves a selection to the start, after the locked preamble", () => {
    const step = bulkMoveStep(UNITS, new Set(["a2", "u2"]), { afterKey: null });

    expect(step?.label).toBe("Moved 2 messages");
    expect(ops(step)).toEqual([
      { kind: "moveUnit", unit: "a2", toIndex: 1 },
      { kind: "moveUnit", unit: "u2", toIndex: 2 },
    ]);
    expect(applyMoves(ORDER, step!)).toEqual(["pre", "a2", "u2", "u1", "a1", "a1t", "a3"]);
  });

  it("moves a selection after a unit and uses the nearest unselected unit as the anchor", () => {
    const after = bulkMoveStep(UNITS, new Set(["u1", "a3"]), { afterKey: "a1t" });
    expect(after?.label).toBe("Moved 2 messages");
    expect(applyMoves(ORDER, after!)).toEqual(["pre", "a1", "a1t", "u1", "a3", "a2", "u2"]);

    const selfAnchor = bulkMoveStep(UNITS, new Set(["u1", "a2"]), { afterKey: "a2" });
    expect(applyMoves(ORDER, selfAnchor!)).toEqual(["pre", "a1", "a1t", "u1", "a2", "a3", "u2"]);
  });

  it("names a single move and returns null when nothing moves", () => {
    expect(bulkMoveStep(UNITS, new Set(["a2"]), { direction: 1 })?.label).toBe("Moved message");
    expect(bulkMoveStep(UNITS, new Set(["a2"]), { afterKey: "a1t" })).toBeNull();
    expect(bulkMoveStep(UNITS, new Set(), { direction: 1 })).toBeNull();
  });

  it("removes thinking of a1t with one op for block 0 of its thinking entry", () => {
    const step = bulkRemoveThinkingStep(UNITS, new Set(["a1", "a1t"]));

    expect(step?.label).toBe("Removed thinking");
    expect(step?.unitKeys).toEqual(["a1t"]);
    expect(ops(step)).toEqual([{ kind: "removeThinking", target: { uuid: "a1t-e1", block: 0 } }]);
  });

  it("removes thinking from several messages, the higher block first in one entry", () => {
    const units = [
      ...UNITS,
      unit("a4", "assistant", {
        blocks: [
          block("a4-e", 0, "thinking"),
          block("a4-e", 1, "text"),
          block("a4-e", 2, "redacted_thinking"),
        ],
      }),
    ];
    const step = bulkRemoveThinkingStep(units, new Set(["a4", "a1t"]));

    expect(step?.label).toBe("Removed thinking from 2 messages");
    expect(ops(step)).toEqual([
      { kind: "removeThinking", target: { uuid: "a1t-e1", block: 0 } },
      { kind: "removeThinking", target: { uuid: "a4-e", block: 2 } },
      { kind: "removeThinking", target: { uuid: "a4-e", block: 0 } },
    ]);
  });

  it("returns null to remove thinking from a selection without thinking", () => {
    expect(bulkRemoveThinkingStep(UNITS, new Set(["a1", "a2"]))).toBeNull();
  });

  it("lists the unlocked unit keys in preview order", () => {
    expect(selectableUnitKeys(UNITS)).toEqual(["u1", "a1", "a1t", "a2", "a3", "u2"]);
  });

  it("turns a drop before or after a row into the unit to put the moved units after", () => {
    expect(dropAfterKey(UNITS, ["a2"], "after")).toBe("a2");
    expect(dropAfterKey(UNITS, ["a1t", "a1"], "after")).toBe("a1t");
    expect(dropAfterKey(UNITS, ["a2"], "before")).toBe("a1t");
    expect(dropAfterKey(UNITS, ["u1"], "before")).toBe("pre");
    expect(dropAfterKey(UNITS.slice(1), ["u1"], "before")).toBeNull();
  });

  it("deletes the selection in one step and anchors the next kept unit", () => {
    const steps: Array<Omit<Step, "id">> = [];
    const selections: Array<Selection> = [];
    deleteSelection(
      { addStep: (step) => steps.push(step), setSelection: (next) => selections.push(next) },
      UNITS,
      { keys: new Set(["a2", "a3"]), anchor: "a2" },
    );

    expect(steps.map((step) => step.label)).toEqual(["Deleted 2 messages"]);
    expect(selections).toEqual([{ keys: new Set(), anchor: "u2" }]);
    deleteSelection(
      { addStep: (step) => steps.push(step), setSelection: (next) => selections.push(next) },
      UNITS,
      { keys: new Set(["u2"]), anchor: "u2" },
    );
    expect(selections.at(-1)).toEqual({ keys: new Set(), anchor: "a3" });
  });
});
