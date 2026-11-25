import type { ForkTranscriptUnitView } from "@t3tools/contracts";

export type EditBlock = "not-claude" | "setting-off" | "not-linked" | "locked" | null;

// A null driver is unknown, so the load result decides. Links count only after the first load.
export const editBlock = (input: {
  readonly driver: string | null;
  readonly enabled: boolean;
  readonly unitKey: string | null;
  readonly unit: ForkTranscriptUnitView | undefined;
  readonly loaded: boolean;
}): EditBlock =>
  !input.enabled
    ? "setting-off"
    : input.driver !== null && input.driver !== "claudeAgent"
      ? "not-claude"
      : !input.loaded
        ? null
        : input.unitKey === null || input.unit === undefined
          ? "not-linked"
          : input.unit.locked
            ? "locked"
            : null;
