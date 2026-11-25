import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

export const rowItemIds = (row: MessagesTimelineRow): ReadonlyArray<string> => {
  switch (row.kind) {
    case "message":
    case "assistant-meta":
      return row.projectedItem === undefined ? [] : [row.projectedItem.item.id];
    case "event":
      return row.projectedItem === undefined ? [] : [row.projectedItem.item.id];
    case "work":
      return row.groupedEntries.flatMap((entry) =>
        entry.projectedItem === undefined ? [] : [entry.projectedItem.item.id],
      );
    case "work-live":
      return row.entry.projectedItem === undefined ? [] : [row.entry.projectedItem.item.id];
    default:
      return [];
  }
};

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
