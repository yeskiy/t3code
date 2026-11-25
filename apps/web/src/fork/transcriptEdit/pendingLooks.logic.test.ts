import type {
  ForkTranscriptDiffItem,
  ForkTranscriptPreviewResult,
  ForkTranscriptUnitView,
  ForkTranscriptViewBlock,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Step } from "./history.logic";
import { draftBadge, insertStep, rowLook, withoutThinkingRemoval } from "./pendingLooks.logic";

const textBlock = (
  uuid: string,
  text: string,
  index: number | null = 0,
): ForkTranscriptViewBlock => ({
  uuid,
  index,
  type: "text",
  text,
  truncated: false,
  editable: true,
  removable: false,
});

const thinkingBlock = (uuid: string, index: number, text: string): ForkTranscriptViewBlock => ({
  uuid,
  index,
  type: "thinking",
  text,
  truncated: false,
  editable: false,
  removable: true,
});

const unit = (
  key: string,
  kind: ForkTranscriptUnitView["kind"],
  blocks: ReadonlyArray<ForkTranscriptViewBlock> = [textBlock(key, `${key} text`)],
  time = "2026-11-25T10:00:00.000Z",
): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time,
  blocks,
  entries: [],
  hidden: [],
  excerpt: `${key} excerpt`,
});

const step = (id: string, unitKeys: ReadonlyArray<string>, ops: Step["items"] = []): Step => ({
  id,
  label: `Label ${id}`,
  unitKeys,
  items: ops,
});

const preview = (
  units: ReadonlyArray<ForkTranscriptUnitView>,
  diff: ReadonlyArray<ForkTranscriptDiffItem>,
  failedAt: ForkTranscriptPreviewResult["failedAt"] = null,
): ForkTranscriptPreviewResult => ({
  units,
  validation: { errors: [], warnings: [] },
  diff,
  failedAt,
});

const diffItem = (
  key: string,
  status: ForkTranscriptDiffItem["status"],
  kind: ForkTranscriptDiffItem["kind"] = "assistant",
): ForkTranscriptDiffItem => ({ key, kind, status, before: null, after: null });

const AT = "2026-11-25T10:05:00.000Z";
const base = [unit("u1", "user"), unit("a1", "assistant"), unit("t1", "tool", [])];

describe("rowLook", () => {
  it("is plain without a change", () => {
    expect(
      rowLook({ baseUnits: base, preview: null, steps: [], unitKeys: ["a1"], nativeIds: ["a1"] }),
    ).toEqual({ kind: "plain" });
  });

  it("marks an edited assistant row with the step and the preview text of its entry", () => {
    const edited = unit("a1", "assistant", [textBlock("a1", "reply two")]);
    const look = rowLook({
      baseUnits: base,
      preview: preview([base[0]!, edited, base[2]!], [diffItem("a1", "changed")]),
      steps: [step("s1", ["u1"]), step("s2", ["a1"])],
      unitKeys: ["a1"],
      nativeIds: ["a1"],
    });
    expect(look).toEqual({
      kind: "marker",
      badge: "Edited",
      tone: "primary",
      step: { id: "s2", number: 2, label: "Label s2" },
      failure: null,
      previewText: "reply two",
    });
  });

  it("joins every text block of a user unit when the item has no native id", () => {
    const edited = unit("u1", "user", [textBlock("u1", "one", 0), textBlock("u1", "two", 1)]);
    const look = rowLook({
      baseUnits: base,
      preview: preview([edited, base[1]!, base[2]!], [diffItem("u1", "changed", "user")]),
      steps: [step("s1", ["u1"])],
      unitKeys: ["u1"],
      nativeIds: [null],
    });
    expect(look.kind === "marker" ? look.previewText : null).toBe("one\n\ntwo");
  });

  it("collapses a removed row and restores its units", () => {
    const look = rowLook({
      baseUnits: base,
      preview: preview([base[0]!, base[1]!], [diffItem("t1", "removed", "tool")]),
      steps: [step("s1", ["t1"])],
      unitKeys: ["t1"],
      nativeIds: ["toolu_1"],
    });
    expect(look).toEqual({
      kind: "removed",
      badge: "Removed",
      label: "Tool",
      excerpt: "t1 excerpt",
      movesAfter: null,
      step: { id: "s1", number: 1, label: "Label s1" },
      restore: { kind: "units", unitKeys: ["t1"] },
    });
  });

  it("shows a moved row at its old place with the excerpt of its new neighbor", () => {
    const look = rowLook({
      baseUnits: base,
      preview: preview([base[2]!, base[0]!, base[1]!], [diffItem("t1", "moved", "tool")]),
      steps: [step("s1", ["t1"])],
      unitKeys: ["u1"],
      nativeIds: [null],
    });
    expect(look).toEqual({ kind: "plain" });
    const moved = rowLook({
      baseUnits: base,
      preview: preview([base[0]!, base[2]!, base[1]!], [diffItem("t1", "moved", "tool")]),
      steps: [step("s1", ["t1"])],
      unitKeys: ["t1"],
      nativeIds: ["toolu_1"],
    });
    expect(moved.kind === "removed" ? [moved.badge, moved.movesAfter] : null).toEqual([
      "Moved",
      "u1 excerpt",
    ]);
  });

  it("gives a mixed row the word of its first change", () => {
    const look = rowLook({
      baseUnits: [...base, unit("t2", "tool", [])],
      preview: preview(base, [diffItem("t2", "removed", "tool")]),
      steps: [step("s1", ["t2"])],
      unitKeys: ["t1", "t2"],
      nativeIds: ["toolu_1", "toolu_2"],
    });
    expect(look.kind === "marker" ? look.badge : null).toBe("Edited");
  });

  it("collapses a row of removed thinking blocks", () => {
    const withThinking = unit("a1", "assistant", [
      thinkingBlock("a1", 0, "pondering"),
      textBlock("a1", "reply", 1),
    ]);
    const look = rowLook({
      baseUnits: [base[0]!, withThinking],
      preview: preview(
        [base[0]!, unit("a1", "assistant", [textBlock("a1", "reply", 1)])],
        [diffItem("a1", "changed")],
      ),
      steps: [step("s1", ["a1"])],
      unitKeys: ["a1"],
      nativeIds: ["a1:thinking:0"],
    });
    expect(look).toEqual({
      kind: "removed",
      badge: "Removed",
      label: "Thinking",
      excerpt: "pondering",
      movesAfter: null,
      step: { id: "s1", number: 1, label: "Label s1" },
      restore: { kind: "thinking", blocks: [{ uuid: "a1", block: 0 }] },
    });
  });

  it("marks the rows of a failed step with Cannot apply", () => {
    const steps = [
      step("s1", ["a1"], [{ op: { kind: "deleteUnit", unit: "a1" }, at: AT }]),
      step("s2", ["u1"], [{ op: { kind: "deleteUnit", unit: "u1" }, at: AT }]),
    ];
    const failed = preview(base, [], { index: 1, message: "Unit not found" });
    expect(
      rowLook({ baseUnits: base, preview: failed, steps, unitKeys: ["u1"], nativeIds: [null] }),
    ).toEqual({
      kind: "marker",
      badge: "Cannot apply",
      tone: "destructive",
      step: { id: "s2", number: 2, label: "Label s2" },
      failure: "Unit not found",
      previewText: null,
    });
    expect(
      rowLook({ baseUnits: base, preview: failed, steps, unitKeys: ["a1"], nativeIds: ["a1"] }),
    ).toEqual({ kind: "plain" });
  });
});

describe("draftBadge", () => {
  it("names the draft change", () => {
    const changes = new Map([
      ["a1", "moved"],
      ["a2", "movedEdited"],
    ] as const);
    expect(draftBadge("inserted", "n1", changes)).toBe("Inserted");
    expect(draftBadge("moved", "a1", changes)).toBe("Moved here");
    expect(draftBadge("moved", "a2", changes)).toBe("Moved and edited");
    expect(draftBadge("fileOnly", "f1", new Map([["f1", "edited"]]))).toBe("Edited");
    expect(draftBadge("fileOnly", "f2", changes)).toBeNull();
  });
});

describe("insertStep", () => {
  const units = [
    unit("u1", "user", undefined, "2026-11-25T10:00:00.000Z"),
    unit("a1", "assistant", undefined, "2026-11-25T10:00:10.000Z"),
  ];

  it("inserts above a unit at its preview index", () => {
    const result = insertStep(units, "a1", "above", "user", "Also check it");
    expect(result.label).toBe("Inserted message");
    const op = result.items[0]?.op;
    expect(op?.kind === "insertMessage" ? [op.index, op.role, op.text] : null).toEqual([
      1,
      "user",
      "Also check it",
    ]);
    expect(result.unitKeys).toEqual([op?.kind === "insertMessage" ? op.uuid : "", "a1"]);
  });

  it("inserts below a unit at its index plus 1", () => {
    const op = insertStep(units, "a1", "below", "assistant", "Done").items[0]?.op;
    expect(
      op?.kind === "insertMessage" ? [op.index, op.messageId?.startsWith("msg_")] : null,
    ).toEqual([2, true]);
  });
});

describe("withoutThinkingRemoval", () => {
  it("drops the removal op and the empty step", () => {
    const steps = [
      step(
        "s1",
        ["a1"],
        [
          { op: { kind: "removeThinking", target: { uuid: "a1", block: 0 } }, at: AT },
          { op: { kind: "removeThinking", target: { uuid: "a1", block: 2 } }, at: AT },
        ],
      ),
      step(
        "s2",
        ["a2"],
        [{ op: { kind: "removeThinking", target: { uuid: "a2", block: 0 } }, at: AT }],
      ),
    ];
    const once = withoutThinkingRemoval(steps, [{ uuid: "a1", block: 0 }]);
    expect(once.map((item) => item.items.length)).toEqual([1, 1]);
    expect(
      withoutThinkingRemoval(steps, [{ uuid: "a2", block: 0 }]).map((item) => item.id),
    ).toEqual(["s1"]);
  });
});
