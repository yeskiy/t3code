import type {
  ForkTranscriptItemLink,
  ForkTranscriptPreviewResult,
  ForkTranscriptUnitView,
} from "@t3tools/contracts";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { Step } from "./history.logic";
import { rowItemIds } from "./rowUnits.logic";

export interface StepRow {
  readonly id: string;
  readonly label: string;
  readonly excerpt: string;
  readonly unitKey: string | null;
  readonly failed: string | null;
}

// The failed op index counts ops over all steps, so each step owns a range of indexes.
export const stepRows = (input: {
  readonly steps: ReadonlyArray<Step>;
  readonly previewUnits: ReadonlyArray<ForkTranscriptUnitView>;
  readonly loadUnits: ReadonlyArray<ForkTranscriptUnitView>;
  readonly failedAt: ForkTranscriptPreviewResult["failedAt"];
}): ReadonlyArray<StepRow> =>
  input.steps.reduce<{ readonly offset: number; readonly rows: ReadonlyArray<StepRow> }>(
    (acc, step) => {
      const unitKey = step.unitKeys[0] ?? null;
      const end = acc.offset + step.items.length;
      const failed =
        input.failedAt !== null && input.failedAt.index >= acc.offset && input.failedAt.index < end
          ? input.failedAt.message
          : null;
      const excerpt =
        [...input.previewUnits, ...input.loadUnits].find((unit) => unit.key === unitKey)?.excerpt ??
        "";
      return {
        offset: end,
        rows: [...acc.rows, { id: step.id, label: step.label, excerpt, unitKey, failed }],
      };
    },
    { offset: 0, rows: [] },
  ).rows;

export const timelineRowIndexForUnit = (
  rows: ReadonlyArray<MessagesTimelineRow>,
  links: ReadonlyArray<ForkTranscriptItemLink>,
  unitKey: string,
): number => {
  const itemIds = new Set(links.flatMap((link) => (link.unitKey === unitKey ? [link.itemId] : [])));
  return rows.findIndex((row) => rowItemIds(row).some((itemId) => itemIds.has(itemId)));
};
