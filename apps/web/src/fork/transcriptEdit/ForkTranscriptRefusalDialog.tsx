/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptEditError } from "@t3tools/contracts";
import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import type { Step } from "./history.logic";
import { type RefusalAction, refusalActionLabel, refusalView } from "./saveRefusal.logic";

const ACTION_VARIANT: Record<RefusalAction, "default" | "outline" | "destructive"> = {
  confirmStop: "destructive",
  reload: "outline",
  reloadKeep: "default",
  dismiss: "outline",
};

// Dismiss goes first, so the footer reads Cancel, then the safer action, then the main one.
const footerOrder = (actions: ReadonlyArray<RefusalAction>): ReadonlyArray<RefusalAction> => [
  ...actions.filter((action) => action === "dismiss"),
  ...actions.filter((action) => action !== "dismiss"),
];

export function ForkTranscriptRefusalDialog(props: {
  readonly error: ForkTranscriptEditError | null;
  readonly busy: boolean;
  readonly confirmStopLabel?: string;
  readonly stopChoice?: ReactNode;
  readonly onAction: (action: RefusalAction) => void;
}) {
  const view = props.error === null ? null : refusalView(props.error);
  return (
    <AlertDialog
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) props.onAction("dismiss");
      }}
    >
      {view === null ? null : (
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{view.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap wrap-anywhere">
              {view.body}
            </AlertDialogDescription>
            {view.actions.includes("confirmStop") ? props.stopChoice : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            {footerOrder(view.actions).map((action) => (
              <Button
                key={action}
                variant={ACTION_VARIANT[action]}
                disabled={props.busy && action !== "dismiss"}
                onClick={() => props.onAction(action)}
              >
                {action === "confirmStop" && props.confirmStopLabel !== undefined
                  ? props.confirmStopLabel
                  : refusalActionLabel(action, view.actions)}
              </Button>
            ))}
          </AlertDialogFooter>
        </AlertDialogPopup>
      )}
    </AlertDialog>
  );
}

export function ForkTranscriptDroppedDialog(props: {
  readonly dropped: ReadonlyArray<Step> | null;
  readonly onClose: () => void;
}) {
  const count = props.dropped?.length ?? 0;
  return (
    <AlertDialog
      open={count > 0}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? "1 change no longer applies" : `${count} changes no longer apply`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The transcript is loaded again. These changes do not fit the new session file, so they
            are removed. Your other changes stay pending.
          </AlertDialogDescription>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {(props.dropped ?? []).map((step) => (
              <li key={step.id}>{step.label}</li>
            ))}
          </ul>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={props.onClose}>Close</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
