/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ContextMenuItem } from "@t3tools/contracts";

export type ForkTranscriptMenuId = "fork-transcript-select" | "fork-transcript-backups";

export interface ForkTranscriptMenuState {
  readonly selectMode: boolean;
}

export const forkTranscriptMenuItems = (
  state: ForkTranscriptMenuState | null | undefined,
): ReadonlyArray<ContextMenuItem<ForkTranscriptMenuId>> =>
  state == null
    ? []
    : [
        {
          id: "fork-transcript-select",
          label: state.selectMode ? "Stop selecting" : "Select messages",
          icon: "circle-check",
          separatorBefore: true,
        },
        { id: "fork-transcript-backups", label: "Transcript backups", icon: "clock" },
      ];
