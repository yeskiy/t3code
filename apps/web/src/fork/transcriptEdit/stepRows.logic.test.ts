import type { ForkTranscriptUnitView, OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { Step } from "./history.logic";
import { stepRows, timelineRowIndexForUnit } from "./stepRows.logic";

const unit = (key: string, excerpt: string): ForkTranscriptUnitView =>
  ({ key, excerpt }) as unknown as ForkTranscriptUnitView;

const step = (id: string, unitKeys: ReadonlyArray<string>, ops = 1): Step => ({
  id,
  label: `Step ${id}`,
  unitKeys,
  items: Array.from({ length: ops }, () => ({
    op: { kind: "deleteUnit", unit: unitKeys[0] ?? "" },
    at: "2026-11-25T10:00:00.000Z",
  })),
});

const messageRow = (id: string, itemId: string) =>
  ({
    kind: "message",
    id,
    projectedItem: { item: { id: itemId } } as unknown as OrchestrationV2ProjectedTurnItem,
  }) as unknown as MessagesTimelineRow;

describe("stepRows", () => {
  it("takes the excerpt of the first unit from the preview, then from the load", () => {
    const rows = stepRows({
      steps: [step("s1", ["new"]), step("s2", ["gone", "other"])],
      previewUnits: [unit("new", "Inserted text")],
      loadUnits: [unit("gone", "Removed text")],
      failedAt: null,
    });
    expect(rows).toEqual([
      { id: "s1", label: "Step s1", excerpt: "Inserted text", unitKey: "new", failed: null },
      { id: "s2", label: "Step s2", excerpt: "Removed text", unitKey: "gone", failed: null },
    ]);
  });

  it("marks the step that holds the failed op", () => {
    const rows = stepRows({
      steps: [step("s1", ["a"], 2), step("s2", ["b"])],
      previewUnits: [],
      loadUnits: [],
      failedAt: { index: 2, message: "unit b is missing" },
    });
    expect(rows.map((row) => row.failed)).toEqual([null, "unit b is missing"]);
  });
});

describe("timelineRowIndexForUnit", () => {
  it("finds the row that renders an item of the unit", () => {
    const rows = [messageRow("r0", "item-0"), messageRow("r1", "item-1")];
    const links = [
      { itemId: "item-0", unitKey: "u0", inherited: false },
      { itemId: "item-1", unitKey: "u1", inherited: false },
    ];
    expect(timelineRowIndexForUnit(rows, links, "u1")).toBe(1);
    expect(timelineRowIndexForUnit(rows, links, "missing")).toBe(-1);
  });
});
