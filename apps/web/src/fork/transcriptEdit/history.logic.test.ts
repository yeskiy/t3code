import type { ForkTranscriptOp, ForkTranscriptPendingOp } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { emptyHistory, flatOps, historyReducer, type Step } from "./history.logic";

const pending = (
  op: ForkTranscriptOp,
  at = "2026-11-25T10:00:00.000Z",
): ForkTranscriptPendingOp => ({
  op,
  at,
});

const editStep = (id: string, uuid: string, text: string): Step => ({
  id,
  label: `Edited ${uuid}`,
  unitKeys: [uuid],
  items: [pending({ kind: "editAssistantText", uuid, block: 0, text })],
});

describe("history.logic", () => {
  it("adds three steps, undoes, and redoes in step order", () => {
    const s1 = editStep("s1", "a1", "one");
    const s2 = editStep("s2", "a2", "two");
    const s3 = editStep("s3", "a3", "three");

    const h1 = historyReducer(emptyHistory, { type: "add", step: s1 });
    const h2 = historyReducer(h1, { type: "add", step: s2 });
    const h3 = historyReducer(h2, { type: "add", step: s3 });
    expect(h3.steps).toEqual([s1, s2, s3]);
    expect(h3.redo).toEqual([]);

    const undone1 = historyReducer(h3, { type: "undo" });
    expect(undone1.steps).toEqual([s1, s2]);
    expect(undone1.redo).toEqual([s3]);

    const undone2 = historyReducer(undone1, { type: "undo" });
    expect(undone2.steps).toEqual([s1]);
    expect(undone2.redo).toEqual([s2, s3]);

    const redone1 = historyReducer(undone2, { type: "redo" });
    expect(redone1.steps).toEqual([s1, s2]);
    expect(redone1.redo).toEqual([s3]);

    // Adding a new step clears redo.
    const s4 = editStep("s4", "a4", "four");
    const branched = historyReducer(redone1, { type: "add", step: s4 });
    expect(branched.steps).toEqual([s1, s2, s4]);
    expect(branched.redo).toEqual([]);
  });

  it("reverts the middle step and leaves steps 1 and 3", () => {
    const s1 = editStep("s1", "a1", "one");
    const s2 = editStep("s2", "a2", "two");
    const s3 = editStep("s3", "a3", "three");
    const h = [s1, s2, s3].reduce(
      (acc, step) => historyReducer(acc, { type: "add", step }),
      emptyHistory,
    );

    const reverted = historyReducer(h, { type: "revert", stepId: "s2" });
    expect(reverted.steps).toEqual([s1, s3]);
    expect(reverted.redo).toEqual([]);
  });

  it("counts a bulk step with two ops as one undo and one redo", () => {
    const bulk: Step = {
      id: "bulk-1",
      label: "Removed thinking",
      unitKeys: ["a1", "a2"],
      items: [
        pending({ kind: "removeThinking", target: { uuid: "a1", block: 0 } }),
        pending({ kind: "removeThinking", target: { uuid: "a2", block: 0 } }),
      ],
    };

    const added = historyReducer(emptyHistory, { type: "add", step: bulk });
    expect(flatOps(added)).toHaveLength(2);

    const undone = historyReducer(added, { type: "undo" });
    expect(undone.steps).toEqual([]);
    expect(undone.redo).toEqual([bulk]);

    const redone = historyReducer(undone, { type: "redo" });
    expect(redone.steps).toEqual([bulk]);
    expect(redone.redo).toEqual([]);
  });

  it("restoreUnit removes one key from a deleteUnits bulk step and keeps the other key", () => {
    const bulkDelete: Step = {
      id: "del-bulk",
      label: "Deleted 2 messages",
      unitKeys: ["a2", "a3"],
      items: [pending({ kind: "deleteUnits", units: ["a2", "a3"] })],
    };
    const h = { steps: [bulkDelete], redo: [editStep("r1", "a1", "redo")] };

    const restored = historyReducer(h, { type: "restoreUnit", unitKey: "a3" });
    expect(restored.redo).toEqual([]);
    expect(restored.steps).toHaveLength(1);
    expect(restored.steps[0]?.unitKeys).toEqual(["a2"]);
    expect(restored.steps[0]?.items).toEqual([pending({ kind: "deleteUnits", units: ["a2"] })]);

    // Restoring the last remaining key drops the step.
    const restoredAll = historyReducer(restored, { type: "restoreUnit", unitKey: "a2" });
    expect(restoredAll.steps).toEqual([]);
  });

  it("restoreUnit on a single deleteUnit or moveUnit drops the step", () => {
    const delStep: Step = {
      id: "del-1",
      label: "Deleted message",
      unitKeys: ["t1"],
      items: [pending({ kind: "deleteUnit", unit: "t1" })],
    };
    const moveStep: Step = {
      id: "move-1",
      label: "Moved message",
      unitKeys: ["a4"],
      items: [pending({ kind: "moveUnit", unit: "a4", toIndex: 1 })],
    };
    const h = { steps: [delStep, moveStep], redo: [] };

    const afterDeleteRestore = historyReducer(h, { type: "restoreUnit", unitKey: "t1" });
    expect(afterDeleteRestore.steps).toEqual([moveStep]);

    const afterMoveRestore = historyReducer(afterDeleteRestore, {
      type: "restoreUnit",
      unitKey: "a4",
    });
    expect(afterMoveRestore.steps).toEqual([]);
  });

  it("restoreUnit acts on the newest matching step only", () => {
    const move1: Step = {
      id: "m1",
      label: "Moved",
      unitKeys: ["a1"],
      items: [pending({ kind: "moveUnit", unit: "a1", toIndex: 2 })],
    };
    const move2: Step = {
      id: "m2",
      label: "Moved again",
      unitKeys: ["a1"],
      items: [pending({ kind: "moveUnit", unit: "a1", toIndex: 3 })],
    };
    const h = { steps: [move1, move2], redo: [] };

    const restored = historyReducer(h, { type: "restoreUnit", unitKey: "a1" });
    expect(restored.steps).toEqual([move1]);
  });

  it("flatOps keeps the order of steps and their ops", () => {
    const op1 = pending({ kind: "editUserText", uuid: "u1", block: null, text: "hi" }, "t1");
    const op2 = pending({ kind: "editAssistantText", uuid: "a1", block: 0, text: "yo" }, "t2");
    const op3 = pending({ kind: "deleteUnit", unit: "t1" }, "t3");
    const h = {
      steps: [
        { id: "s1", label: "step 1", unitKeys: ["u1", "a1"], items: [op1, op2] },
        { id: "s2", label: "step 2", unitKeys: ["t1"], items: [op3] },
      ],
      redo: [],
    };

    expect(flatOps(h)).toEqual([op1, op2, op3]);
  });

  it("supports replace and clear actions", () => {
    const s1 = editStep("s1", "a1", "one");
    const s2 = editStep("s2", "a2", "two");
    const h = { steps: [s1], redo: [s2] };

    const replaced = historyReducer(h, { type: "replace", steps: [s2] });
    expect(replaced).toEqual({ steps: [s2], redo: [] });

    const cleared = historyReducer(replaced, { type: "clear" });
    expect(cleared).toEqual(emptyHistory);
  });
});
