/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  ForkTranscriptBackup,
  ForkTranscriptEditError,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { useContext } from "react";

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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { toastManager } from "~/components/ui/toast";
import { formatBytes } from "~/lib/formatBytes";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { formatDateTimeTimestamp } from "~/timestampFormat";
import {
  createForkTranscriptEditActions,
  forkTranscriptEditSessionAtom,
  toEditError,
} from "./editSession";
import { ForkTranscriptRefusalDialog } from "./ForkTranscriptRefusalDialog";
import type { RefusalAction } from "./saveRefusal.logic";
import { saveToast } from "./saveRefusal.logic";
import {
  forkTranscriptBackups,
  forkTranscriptDeleteBackup,
  forkTranscriptRestore,
} from "./transcriptEditRpc";

interface BackupsDialogState {
  readonly threadKey: string;
  readonly status: "loading" | "ready" | "error";
  readonly backups: ReadonlyArray<ForkTranscriptBackup>;
  readonly error: string | null;
  readonly confirm: {
    readonly kind: "restore" | "delete";
    readonly backup: ForkTranscriptBackup;
  } | null;
  readonly busy: boolean;
  readonly refusal: {
    readonly error: ForkTranscriptEditError;
    readonly backup: ForkTranscriptBackup;
  } | null;
}

const backupsDialogAtom = Atom.make<BackupsDialogState | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:transcript-edit:backups-dialog"),
);

registerThreadOverlay((threadKey) => {
  const current = appAtomRegistry.get(backupsDialogAtom);
  if (current !== null && current.threadKey !== threadKey) {
    appAtomRegistry.set(backupsDialogAtom, null);
  }
});

const patch = (registry: AtomRegistry.AtomRegistry, next: Partial<BackupsDialogState>) => {
  const current = registry.get(backupsDialogAtom);
  if (current !== null) registry.set(backupsDialogAtom, { ...current, ...next });
};

const COMMAND_OPTIONS = { reportFailure: false, reportDefect: false } as const;

const listBackups = async (registry: AtomRegistry.AtomRegistry, threadRef: ScopedThreadRef) => {
  patch(registry, { status: "loading", error: null });
  const result = await runAtomCommand(
    registry,
    forkTranscriptBackups,
    { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId } },
    COMMAND_OPTIONS,
  );
  patch(
    registry,
    result._tag === "Success"
      ? { status: "ready", backups: result.value }
      : { status: "error", error: toEditError(result.cause, "badBackup").detail },
  );
};

/** Opens the backups dialog of a thread. The thread menu item "Transcript backups" calls it. */
export const openForkTranscriptBackups = (threadKey: string, threadRef: ScopedThreadRef) => {
  appAtomRegistry.set(backupsDialogAtom, {
    threadKey,
    status: "loading",
    backups: [],
    error: null,
    confirm: null,
    busy: false,
    refusal: null,
  });
  return listBackups(appAtomRegistry, threadRef);
};

const restoreBackup = async (input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly backup: ForkTranscriptBackup;
  readonly confirmStop: boolean;
}) => {
  const { registry, threadKey, threadRef, backup } = input;
  const actions = createForkTranscriptEditActions({ registry, threadKey, threadRef });
  patch(registry, { busy: true, confirm: null, refusal: null });
  if (registry.get(forkTranscriptEditSessionAtom(threadKey)).history.steps.length > 0) {
    actions.discard();
  }
  await actions.ensureLoaded();
  const session = registry.get(forkTranscriptEditSessionAtom(threadKey));
  if (session.load === null) {
    patch(registry, { busy: false });
    toastManager.add({
      type: "error",
      title: "Could not load the transcript",
      description: session.error?.detail ?? "The session file cannot be read.",
    });
    return;
  }
  const result = await runAtomCommand(
    registry,
    forkTranscriptRestore,
    {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        baseKey: session.load.baseKey,
        backup: backup.name,
        source: backup.source,
        confirmStop: input.confirmStop,
      },
    },
    COMMAND_OPTIONS,
  );
  if (result._tag === "Failure") {
    patch(registry, {
      busy: false,
      refusal: { error: toEditError(result.cause, "badBackup"), backup },
    });
    return;
  }
  const notes = saveToast(result.value).description;
  toastManager.add({
    type: "success",
    title: "Restored. Claude sees the restored history on the next message.",
    ...(notes === null ? {} : { description: notes }),
  });
  actions.discard();
  patch(registry, { busy: false });
  await listBackups(registry, threadRef);
};

const deleteBackup = async (
  registry: AtomRegistry.AtomRegistry,
  threadRef: ScopedThreadRef,
  backup: ForkTranscriptBackup,
) => {
  patch(registry, { busy: true, confirm: null });
  const result = await runAtomCommand(
    registry,
    forkTranscriptDeleteBackup,
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, backup: backup.name, source: backup.source },
    },
    COMMAND_OPTIONS,
  );
  patch(registry, { busy: false });
  if (result._tag === "Failure") {
    toastManager.add({
      type: "error",
      title: "Could not delete the backup",
      description: toEditError(result.cause, "badBackup").detail,
    });
    return;
  }
  await listBackups(registry, threadRef);
};

function BackupRow(props: {
  readonly backup: ForkTranscriptBackup;
  readonly busy: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onRestore: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-xs">{props.backup.name}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {formatDateTimeTimestamp(props.backup.createdAt, props.timestampFormat)}
          <span aria-hidden="true">-</span>
          {formatBytes(props.backup.size)}
          <Badge variant="outline" size="sm">
            {props.backup.source === "t3" ? "T3" : "Old editor"}
          </Badge>
        </span>
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={props.busy}
        aria-label={`Restore ${props.backup.name}`}
        onClick={props.onRestore}
      >
        Restore
      </Button>
      <Button
        size="xs"
        variant="ghost-destructive"
        disabled={props.busy}
        aria-label={`Delete ${props.backup.name}`}
        onClick={props.onDelete}
      >
        Delete
      </Button>
    </li>
  );
}

export function ForkTranscriptBackupsDialogHost(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef | null;
  readonly timestampFormat: TimestampFormat;
}) {
  const registry = useContext(RegistryContext);
  const state = useAtomValue(backupsDialogAtom);
  const pendingSteps = useAtomValue(
    forkTranscriptEditSessionAtom(props.threadKey),
    (session) => session.history.steps.length,
  );
  const { threadKey, threadRef } = props;
  if (state === null || threadRef === null || state.threadKey !== threadKey) {
    return null;
  }
  const confirm = state.confirm;
  const onRefusal = (action: RefusalAction) => {
    const refusal = state.refusal;
    if (refusal === null || action === "dismiss") return patch(registry, { refusal: null });
    if (action === "confirmStop") {
      return void restoreBackup({
        registry,
        threadKey,
        threadRef,
        backup: refusal.backup,
        confirmStop: true,
      });
    }
    patch(registry, { refusal: null });
    void createForkTranscriptEditActions({ registry, threadKey, threadRef }).reload(false);
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => (open ? undefined : registry.set(backupsDialogAtom, null))}
      >
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transcript backups</DialogTitle>
            <DialogDescription>
              Each save and each restore writes a backup of the session file first. The newest 20 T3
              backups stay. Old editor backups sit next to the session file.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {state.status === "error" ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : state.status === "loading" && state.backups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Reading the backups...</p>
            ) : state.backups.length === 0 ? (
              <p className="text-sm text-muted-foreground">This session has no backups yet.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {state.backups.map((backup) => (
                  <BackupRow
                    key={`${backup.source}:${backup.name}`}
                    backup={backup}
                    busy={state.busy}
                    timestampFormat={props.timestampFormat}
                    onRestore={() => patch(registry, { confirm: { kind: "restore", backup } })}
                    onDelete={() => patch(registry, { confirm: { kind: "delete", backup } })}
                  />
                ))}
              </ul>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : patch(registry, { confirm: null }))}
      >
        {confirm === null ? null : (
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm.kind === "restore" ? "Restore this backup?" : "Delete this backup?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm.kind === "restore"
                  ? "The current session file is backed up first. Then the backup content replaces it."
                  : "This cannot be undone."}
                {confirm.kind === "restore" && pendingSteps > 0
                  ? ` Your ${pendingSteps === 1 ? "1 pending change is" : `${pendingSteps} pending changes are`} discarded.`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                variant={confirm.kind === "restore" ? "default" : "destructive"}
                onClick={() =>
                  void (confirm.kind === "restore"
                    ? restoreBackup({
                        registry,
                        threadKey,
                        threadRef,
                        backup: confirm.backup,
                        confirmStop: false,
                      })
                    : deleteBackup(registry, threadRef, confirm.backup))
                }
              >
                {confirm.kind === "restore" ? "Restore" : "Delete"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        )}
      </AlertDialog>
      <ForkTranscriptRefusalDialog
        error={state.refusal?.error ?? null}
        busy={state.busy}
        confirmStopLabel="Stop and restore"
        onAction={onRefusal}
      />
    </>
  );
}
