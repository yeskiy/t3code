/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { registerThreadOverlay } from "~/components/chat/threadOverlayRetention";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  type BackgroundWorkTurnItemRef,
  formatStopBackgroundConfirmDescription,
} from "./composerStop.logic";

const stopBackgroundConfirmAtom = Atom.make<{ readonly threadKey: string } | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:stop-background-confirm"),
);

registerThreadOverlay((threadKey) => {
  const entry = appAtomRegistry.get(stopBackgroundConfirmAtom);
  if (entry !== null && entry.threadKey !== threadKey) {
    appAtomRegistry.set(stopBackgroundConfirmAtom, null);
  }
});

export function openForkStopBackgroundConfirm(threadKey: string): void {
  appAtomRegistry.set(stopBackgroundConfirmAtom, { threadKey });
}

function closeForkStopBackgroundConfirm(): void {
  appAtomRegistry.set(stopBackgroundConfirmAtom, null);
}

export function ForkStopBackgroundConfirmHost(props: {
  readonly threadKey: string | null;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly turnItems: ReadonlyArray<BackgroundWorkTurnItemRef>;
  readonly canOperateThread: boolean;
  readonly onConfirm: () => void;
}) {
  const entry = useAtomValue(stopBackgroundConfirmAtom);
  const open = props.threadKey !== null && entry?.threadKey === props.threadKey;
  const description = formatStopBackgroundConfirmDescription(props.tasks, props.turnItems);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeForkStopBackgroundConfirm();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop background work?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            disabled={!props.canOperateThread || props.tasks.length === 0}
            onClick={() => {
              closeForkStopBackgroundConfirm();
              props.onConfirm();
            }}
          >
            Stop all
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
