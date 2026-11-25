import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "~/session-logic";
import { rowItemIds, rowUnitKeys } from "./rowUnits.logic";

const projected = (id: string): OrchestrationV2ProjectedTurnItem =>
  ({ item: { id } }) as unknown as OrchestrationV2ProjectedTurnItem;

const workEntry = (id: string, itemId?: string): WorkLogEntry =>
  ({
    id,
    createdAt: "2026-11-25T10:00:00.000Z",
    label: "Tool",
    tone: "tool",
    ...(itemId === undefined ? {} : { projectedItem: projected(itemId) }),
  }) as WorkLogEntry;

describe("rowUnits.logic", () => {
  it("extracts item id from message, assistant-meta, and event rows", () => {
    const messageRow = {
      kind: "message",
      id: "row-u1",
      createdAt: "2026-11-25T10:00:00.000Z",
      projectedItem: projected("item-u1"),
    } as unknown as MessagesTimelineRow;
    expect(rowItemIds(messageRow)).toEqual(["item-u1"]);

    const missingProjected = {
      kind: "message",
      id: "row-u2",
      createdAt: "2026-11-25T10:00:00.000Z",
    } as unknown as MessagesTimelineRow;
    expect(rowItemIds(missingProjected)).toEqual([]);

    const metaRow = {
      kind: "assistant-meta",
      id: "row-meta",
      createdAt: "2026-11-25T10:00:00.000Z",
      projectedItem: projected("item-a1"),
    } as unknown as MessagesTimelineRow;
    expect(rowItemIds(metaRow)).toEqual(["item-a1"]);

    const eventRow = {
      kind: "event",
      id: "row-ev",
      createdAt: "2026-11-25T10:00:00.000Z",
      projectedItem: projected("item-sys1"),
    } as unknown as MessagesTimelineRow;
    expect(rowItemIds(eventRow)).toEqual(["item-sys1"]);
  });

  it("extracts item ids from work and work-live rows", () => {
    const workRow = {
      kind: "work",
      id: "row-work",
      createdAt: "2026-11-25T10:00:00.000Z",
      groupedEntries: [
        workEntry("w1", "item-t1"),
        workEntry("w2", "item-t2"),
        workEntry("w3", "item-t3"),
      ],
      isExpandedToolGroup: true,
    } as unknown as MessagesTimelineRow;
    expect(rowItemIds(workRow)).toEqual(["item-t1", "item-t2", "item-t3"]);

    const liveRow = {
      kind: "work-live",
      id: "row-live",
      createdAt: "2026-11-25T10:00:00.000Z",
      entry: workEntry("w-live", "item-live"),
      groupedEntries: [],
      groupId: "g1",
      expanded: false,
      active: true,
    } as unknown as MessagesTimelineRow;
    expect(rowItemIds(liveRow)).toEqual(["item-live"]);
  });

  it("returns an empty array for working and other non-item rows", () => {
    const workingRow: MessagesTimelineRow = {
      kind: "working",
      id: "working-1",
      createdAt: null,
    };
    const thinkingRow: MessagesTimelineRow = {
      kind: "thinking",
      id: "thinking-1",
      createdAt: null,
    };

    expect(rowItemIds(workingRow)).toEqual([]);
    expect(rowItemIds(thinkingRow)).toEqual([]);
  });

  it("rowUnitKeys deduplicates items of one unit in row order", () => {
    const workRow = {
      kind: "work",
      id: "row-work",
      createdAt: "2026-11-25T10:00:00.000Z",
      groupedEntries: [
        workEntry("w1", "item-1"),
        workEntry("w2", "item-2"),
        workEntry("w3", "item-unmapped"),
        workEntry("w4", "item-3"),
      ],
      isExpandedToolGroup: true,
    } as unknown as MessagesTimelineRow;

    const unitKeyByItemId = new Map<string, string>([
      ["item-1", "unit-tool-1"],
      ["item-2", "unit-tool-1"],
      ["item-3", "unit-tool-2"],
    ]);

    expect(rowUnitKeys(workRow, unitKeyByItemId)).toEqual(["unit-tool-1", "unit-tool-2"]);
  });
});
