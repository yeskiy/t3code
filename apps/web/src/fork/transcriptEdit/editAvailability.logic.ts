import type { ForkTranscriptUnitView } from "@t3tools/contracts";

import type { RowCut } from "./compaction.logic";

export type EditBlock =
  | "not-claude"
  | "setting-off"
  | "before-compaction"
  | "earlier-session"
  | "not-linked"
  | "locked"
  | "handoff"
  | null;

// A null driver is unknown, so the load result decides. A linked unit wins over the cut marks.
export const editBlock = (input: {
  readonly driver: string | null;
  readonly enabled: boolean;
  readonly unitKey: string | null;
  readonly unit: ForkTranscriptUnitView | undefined;
  readonly loaded: boolean;
  readonly cut: RowCut;
}): EditBlock =>
  !input.enabled
    ? "setting-off"
    : input.driver !== null && input.driver !== "claudeAgent"
      ? "not-claude"
      : input.loaded && input.unitKey !== null && input.unit !== undefined
        ? input.unit.locked
          ? input.unit.handoff === true
            ? "handoff"
            : "locked"
          : null
        : input.cut !== null
          ? input.cut
          : input.loaded
            ? "not-linked"
            : null;

export const LOCKED_TOOLTIP = "This entry is locked. The session needs it.";

export const HANDOFF_TOOLTIP =
  "This message holds the summary of the earlier Claude sessions that T3 sent after a recovery. It is locked, because Claude needs it.";
