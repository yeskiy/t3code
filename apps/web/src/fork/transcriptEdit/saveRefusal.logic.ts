/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptEditError, ForkTranscriptSaveResult } from "@t3tools/contracts";

export type RefusalAction = "reload" | "reloadKeep" | "confirmStop" | "dismiss";

export interface RefusalView {
  readonly title: string;
  readonly body: string;
  readonly actions: ReadonlyArray<RefusalAction>;
}

const REFUSALS: Record<
  ForkTranscriptEditError["code"],
  { readonly title: string; readonly actions: ReadonlyArray<RefusalAction> }
> = {
  busy: { title: "The thread is working now", actions: ["confirmStop", "dismiss"] },
  stopFailed: { title: "The turn did not stop", actions: ["dismiss"] },
  stale: {
    title: "The session changed after you started editing",
    actions: ["reload", "reloadKeep", "dismiss"],
  },
  invalid: { title: "The edited transcript is not valid", actions: ["dismiss"] },
  changed: {
    title: "A change no longer applies to the session file",
    actions: ["reloadKeep", "dismiss"],
  },
  writeFailed: { title: "The save did not finish", actions: ["dismiss"] },
  "not-claude": { title: "The transcript cannot be saved", actions: ["dismiss"] },
  "no-session-file": { title: "The transcript cannot be saved", actions: ["dismiss"] },
  badBackup: { title: "The transcript cannot be saved", actions: ["dismiss"] },
};

// The body is the server detail, so the owner sees the real reason and any backup name.
export const refusalView = (
  error: Pick<ForkTranscriptEditError, "code" | "detail">,
): RefusalView => ({
  ...REFUSALS[error.code],
  body: error.detail,
});

const ACTION_LABELS: Record<Exclude<RefusalAction, "dismiss">, string> = {
  reload: "Reload",
  reloadKeep: "Reload and keep my changes",
  confirmStop: "Stop and save",
};

export const refusalActionLabel = (
  action: RefusalAction,
  actions: ReadonlyArray<RefusalAction>,
): string =>
  action === "dismiss" ? (actions.length === 1 ? "Close" : "Cancel") : ACTION_LABELS[action];

const count = (value: number, one: string, other: string) =>
  `${value} ${value === 1 ? one : other}`;

export const saveToast = (
  result: Pick<ForkTranscriptSaveResult, "inheritedUnits" | "unmappedUnits">,
): { readonly title: string; readonly description: string | null } => {
  const notes = [
    result.inheritedUnits === 0
      ? null
      : `${count(result.inheritedUnits, "message", "messages")} from the parent thread kept their old text in the timeline.`,
    result.unmappedUnits === 0
      ? null
      : `${count(result.unmappedUnits, "change is", "changes are")} not shown in the timeline.`,
  ].filter((note) => note !== null);
  return {
    title: "Saved. Claude sees the edited history on the next message.",
    description: notes.length === 0 ? null : notes.join(" "),
  };
};
