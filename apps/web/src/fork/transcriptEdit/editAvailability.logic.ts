import type { ForkTranscriptUnitView } from "@t3tools/contracts";

export type EditBlock =
  | "not-claude"
  | "setting-off"
  | "before-compaction"
  | "not-linked"
  | "locked"
  | null;

// A null driver is unknown, so the load result decides. A linked unit wins over the compaction mark.
export const editBlock = (input: {
  readonly driver: string | null;
  readonly enabled: boolean;
  readonly unitKey: string | null;
  readonly unit: ForkTranscriptUnitView | undefined;
  readonly loaded: boolean;
  readonly beforeCompaction: boolean;
}): EditBlock =>
  !input.enabled
    ? "setting-off"
    : input.driver !== null && input.driver !== "claudeAgent"
      ? "not-claude"
      : input.loaded && input.unitKey !== null && input.unit !== undefined
        ? input.unit.locked
          ? "locked"
          : null
        : input.beforeCompaction
          ? "before-compaction"
          : input.loaded
            ? "not-linked"
            : null;
