/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import { Redo2Icon, Undo2Icon } from "lucide-react";
import { useContext, type ReactNode } from "react";

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
import { Checkbox } from "~/components/ui/checkbox";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatShortcutLabel } from "~/keybindings";
import {
  forkTranscriptEditSessionAtom,
  useForkTranscriptEditActions,
  useForkTranscriptEditSession,
} from "./editSession";
import {
  ForkTranscriptDroppedDialog,
  ForkTranscriptRefusalDialog,
} from "./ForkTranscriptRefusalDialog";
import { ForkTranscriptReviewDialog } from "./ForkTranscriptReviewDialog";
import type { RefusalAction } from "./saveRefusal.logic";
import {
  patchSaveBar,
  useForkThreadWorking,
  useForkTranscriptSave,
  useForkTranscriptSaveBarState,
} from "./saveFlow";
import { toggleForkTranscriptSelectMode } from "./transcriptEditCommands";

const SAVE_BLOCKED =
  "Saving is blocked until the errors are gone. If a change caused them, revert it.";

const shortcutLabel = (value: string) => {
  const shortcut = parseKeybindingShortcut(value);
  return shortcut === null ? "" : formatShortcutLabel(shortcut);
};

const errorCount = (session: ReturnType<typeof useForkTranscriptEditSession>) =>
  (session.preview?.validation ?? session.load?.validation)?.errors.length ?? 0;

export function ForkTranscriptSaveBarValidation(props: { readonly threadKey: string }) {
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(props.threadKey);
  const errors = errorCount(session);
  if (session.history.steps.length === 0) return null;
  if (session.preview?.failedAt != null) {
    return <span className="text-destructive">A change cannot apply.</span>;
  }
  if (errors === 0) return <span>Validation passed.</span>;
  return (
    <button
      type="button"
      className="font-medium text-destructive underline-offset-2 hover:underline"
      onClick={() => patchSaveBar(registry, props.threadKey, { popover: "errors" })}
    >
      {errors === 1 ? "1 error" : `${errors} errors`}
    </button>
  );
}

function ForkTranscriptContinueChoice(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const session = useForkTranscriptEditSession(props.threadKey);
  const actions = useForkTranscriptEditActions(props.threadKey, props.threadRef);
  const working = useForkThreadWorking(props.threadRef);
  if (!working) return null;
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Checkbox
        checked={session.after === "continue"}
        onCheckedChange={(checked) => actions.setAfter(checked ? "continue" : "idle")}
      />
      After the save: Continue the task
    </label>
  );
}

function IconAction(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function ForkTranscriptSaveBarActions(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(props.threadKey);
  const actions = useForkTranscriptEditActions(props.threadKey, props.threadRef);
  const bar = useForkTranscriptSaveBarState(props.threadKey);
  const save = useForkTranscriptSave(props.threadKey, props.threadRef);
  const steps = session.history.steps.length;
  const errors = errorCount(session);
  const failed = session.preview?.failedAt != null;
  const saveBlocked = bar.saving || steps === 0 || errors > 0 || failed || session.load === null;
  const patch = (next: Parameters<typeof patchSaveBar>[2]) =>
    patchSaveBar(registry, props.threadKey, next);
  const continueChoice = (
    <ForkTranscriptContinueChoice threadKey={props.threadKey} threadRef={props.threadRef} />
  );

  const onRefusal = async (action: RefusalAction) => {
    if (action === "dismiss") return patch({ refusal: null });
    if (action === "confirmStop") return save(true);
    patch({ refusal: null });
    const dropped = await actions.reload(action === "reloadKeep");
    const reloaded = registry.get(forkTranscriptEditSessionAtom(props.threadKey));
    if (reloaded.status === "error" && reloaded.error !== null) {
      toastManager.add({
        type: "error",
        title: "Could not load the transcript",
        description: reloaded.error.detail,
      });
      return;
    }
    if (dropped.length > 0) patch({ dropped });
  };

  return (
    <>
      {continueChoice}
      <IconAction
        label={`Undo (${shortcutLabel("mod+z")})`}
        disabled={steps === 0 || bar.saving}
        onClick={() => actions.dispatchHistory({ type: "undo" })}
      >
        <Undo2Icon />
      </IconAction>
      <IconAction
        label={`Redo (${shortcutLabel("mod+shift+z")})`}
        disabled={session.history.redo.length === 0 || bar.saving}
        onClick={() => actions.dispatchHistory({ type: "redo" })}
      >
        <Redo2Icon />
      </IconAction>
      {session.selectMode ? null : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void toggleForkTranscriptSelectMode(registry, props.threadKey, props.threadRef)
          }
        >
          Select
        </Button>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={steps === 0}
        onClick={() => patch({ review: true, popover: null })}
      >
        Review changes
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={steps === 0 || bar.saving}
        onClick={() => patch({ discard: true, popover: null })}
      >
        Discard
      </Button>
      <Tooltip>
        <TooltipTrigger render={<span className="flex" />}>
          <Button size="xs" disabled={saveBlocked} onClick={() => void save(false)}>
            {bar.saving ? "Saving..." : "Save"}
          </Button>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {errors > 0 || failed ? SAVE_BLOCKED : "Write every pending change to the session file"}
        </TooltipPopup>
      </Tooltip>

      <ForkTranscriptReviewDialog
        threadKey={props.threadKey}
        threadRef={props.threadRef}
        continueChoice={continueChoice}
        saveBlocked={saveBlocked}
        onSave={() => void save(false)}
      />
      <AlertDialog open={bar.discard} onOpenChange={(open) => patch({ discard: open })}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {steps === 1 ? "Discard 1 pending change?" : `Discard ${steps} pending changes?`}
            </AlertDialogTitle>
            <AlertDialogDescription>The session file stays as it is.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                patch({ discard: false });
                actions.discard();
              }}
            >
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <ForkTranscriptRefusalDialog
        error={bar.refusal}
        busy={bar.saving}
        stopChoice={continueChoice}
        onAction={(action) => void onRefusal(action)}
      />
      <ForkTranscriptDroppedDialog dropped={bar.dropped} onClose={() => patch({ dropped: null })} />
    </>
  );
}
