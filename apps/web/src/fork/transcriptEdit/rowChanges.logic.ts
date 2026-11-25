import type { ForkTranscriptDiffItem, ForkTranscriptUnitView } from "@t3tools/contracts";

export type UnitChange = "edited" | "moved" | "movedEdited" | "removed" | "inserted";

const mapDiffStatus = (status: ForkTranscriptDiffItem["status"]): UnitChange => {
  switch (status) {
    case "changed":
      return "edited";
    case "moved":
      return "moved";
    case "movedChanged":
      return "movedEdited";
    case "removed":
      return "removed";
    case "added":
      return "inserted";
  }
};

export const unitChanges = (
  diff: ReadonlyArray<ForkTranscriptDiffItem>,
): ReadonlyMap<string, UnitChange> =>
  new Map(diff.map((item) => [item.key, mapDiffStatus(item.status)] as const));

export interface DraftAnchor {
  readonly afterUnitKey: string | null;
  readonly unit: ForkTranscriptUnitView;
  readonly change: "inserted" | "moved" | "fileOnly" | "removed";
}

// A removed file-only unit has no row, so it keeps a draft at its base place for Restore.
const removedFileOnlyAnchors = (input: {
  readonly base: ReadonlyArray<ForkTranscriptUnitView>;
  readonly linkedUnitKeys: ReadonlySet<string>;
  readonly changes: ReadonlyMap<string, UnitChange>;
}): ReadonlyArray<DraftAnchor> =>
  input.base.reduce<{
    readonly lastLinked: string | null;
    readonly anchors: ReadonlyArray<DraftAnchor>;
  }>(
    (acc, unit) =>
      input.linkedUnitKeys.has(unit.key)
        ? { lastLinked: unit.key, anchors: acc.anchors }
        : input.changes.get(unit.key) === "removed"
          ? {
              lastLinked: acc.lastLinked,
              anchors: [...acc.anchors, { afterUnitKey: acc.lastLinked, unit, change: "removed" }],
            }
          : acc,
    { lastLinked: null, anchors: [] },
  ).anchors;

export const draftAnchors = (input: {
  readonly preview: ReadonlyArray<ForkTranscriptUnitView>;
  readonly base?: ReadonlyArray<ForkTranscriptUnitView>;
  readonly linkedUnitKeys: ReadonlySet<string>;
  readonly changes: ReadonlyMap<string, UnitChange>;
}): ReadonlyArray<DraftAnchor> => [
  ...removedFileOnlyAnchors({ ...input, base: input.base ?? [] }),
  ...input.preview.reduce<{
    readonly lastLinked: string | null;
    readonly anchors: ReadonlyArray<DraftAnchor>;
  }>(
    (acc, unit) => {
      const change = input.changes.get(unit.key);
      if (change === "inserted") {
        return {
          lastLinked: acc.lastLinked,
          anchors: [...acc.anchors, { afterUnitKey: acc.lastLinked, unit, change: "inserted" }],
        };
      }
      if (change === "moved" || change === "movedEdited") {
        return {
          lastLinked: acc.lastLinked,
          anchors: [...acc.anchors, { afterUnitKey: acc.lastLinked, unit, change: "moved" }],
        };
      }
      if (!input.linkedUnitKeys.has(unit.key)) {
        return {
          lastLinked: acc.lastLinked,
          anchors: [...acc.anchors, { afterUnitKey: acc.lastLinked, unit, change: "fileOnly" }],
        };
      }
      return { lastLinked: unit.key, anchors: acc.anchors };
    },
    { lastLinked: null, anchors: [] },
  ).anchors,
];
