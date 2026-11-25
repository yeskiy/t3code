import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

export const rowProjectedItems = (
  row: MessagesTimelineRow,
): ReadonlyArray<OrchestrationV2ProjectedTurnItem> => {
  switch (row.kind) {
    case "message":
    case "assistant-meta":
    case "event":
      return row.projectedItem === undefined ? [] : [row.projectedItem];
    case "work":
      return row.groupedEntries.flatMap((entry) =>
        entry.projectedItem === undefined ? [] : [entry.projectedItem],
      );
    case "work-toggle":
      return row.expanded
        ? []
        : (row.groupedEntries ?? []).flatMap((entry) =>
            entry.projectedItem === undefined ? [] : [entry.projectedItem],
          );
    case "work-live":
      return row.entry.projectedItem === undefined ? [] : [row.entry.projectedItem];
    default:
      return [];
  }
};

export const rowItemIds = (row: MessagesTimelineRow): ReadonlyArray<string> =>
  rowProjectedItems(row).map((projected) => projected.item.id);

export const rowUnitKeys = (
  row: MessagesTimelineRow,
  unitKeyByItemId: ReadonlyMap<string, string>,
): ReadonlyArray<string> => {
  const keys = rowItemIds(row).flatMap((itemId) => {
    const unitKey = unitKeyByItemId.get(itemId);
    return unitKey === undefined ? [] : [unitKey];
  });
  return [...new Set(keys)];
};
