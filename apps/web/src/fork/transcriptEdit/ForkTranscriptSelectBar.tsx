/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BetweenHorizontalEndIcon,
  BetweenHorizontalStartIcon,
  BrainIcon,
  MoveVerticalIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, type RefObject, useContext, useState } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { ComposerBanner } from "~/components/chat/ComposerBanner";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Separator } from "~/components/ui/separator";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatShortcutLabel } from "~/keybindings";
import {
  bulkMoveStep,
  bulkRemoveThinkingStep,
  deleteSelection,
  hasRemovableThinking,
  selectableUnitKeys,
} from "./bulkSteps.logic";
import {
  forkTranscriptEditSessionAtom,
  useForkTranscriptEditActions,
  useForkTranscriptEditSession,
} from "./editSession";
import type { Step } from "./history.logic";
import { ForkTranscriptMoveDialog } from "./ForkTranscriptMoveDialog";
import { forkTranscriptRowIdOfUnit } from "./ForkTranscriptRowCheckbox";
import { restoreSelectFocus } from "./ForkTranscriptSelectDnd";
import { forkTranscriptInsertTargetAtom, type InsertTarget } from "./pendingState";
import { pendingUnits } from "./pendingUnits.logic";
import { emptySelection, selectAll } from "./selection.logic";
import { timelineRowIndexForUnit } from "./stepRows.logic";

const shortcutLabel = (value: string) => {
  const shortcut = parseKeybindingShortcut(value);
  return shortcut === null ? null : formatShortcutLabel(shortcut);
};

// A disabled button gets no pointer events, so the tooltip hangs on a wrapper span.
// A press keeps the focus in the timeline, so the Select keys keep working after it.
function BarAction(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly iconOnly?: boolean;
  readonly shortcut?: string;
  readonly blockedBy: string | null;
  readonly destructive?: boolean;
  readonly onClick: () => void;
}) {
  const keys = props.shortcut === undefined ? null : shortcutLabel(props.shortcut);
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        <Button
          size={props.iconOnly === true ? "icon-xs" : "xs"}
          variant={props.destructive === true ? "ghost-destructive" : "ghost"}
          aria-label={props.label}
          disabled={props.blockedBy !== null}
          data-fork-transcript-select-action={props.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={props.onClick}
        >
          {props.icon}
          {props.iconOnly === true ? null : props.label}
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex items-center gap-2">
          {props.blockedBy ?? props.label}
          {props.blockedBy === null && keys !== null ? <Kbd>{keys}</Kbd> : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

const Divider = () => (
  <Separator orientation="vertical" className="h-4 self-center" aria-hidden="true" />
);

/** The Select mode row of the save bar: the selection count, the bulk actions, and Done. */
export function ForkTranscriptSelectBar(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly listRef: RefObject<LegendListRef | null>;
}) {
  const { threadKey } = props;
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(threadKey);
  const actions = useForkTranscriptEditActions(threadKey, props.threadRef);
  const [moveOpen, setMoveOpen] = useState(false);
  const pending = pendingUnits(session);
  const units = pending ?? session.preview?.units ?? session.load?.units ?? [];
  const order = selectableUnitKeys(units);
  const picked = order.filter((key) => session.selection.keys.has(key));
  const pickedSet = new Set(picked);
  const allPicked = order.length > 0 && picked.length === order.length;
  const busy =
    session.load === null
      ? "Loading the transcript..."
      : session.preview?.failedAt != null
        ? "A change cannot apply. Undo or revert it first."
        : pending === null
          ? "Updating the preview..."
          : null;
  const needsPick = busy ?? (picked.length === 0 ? "Select one or more messages first." : null);
  const needsOne =
    busy ?? (picked.length === 1 ? null : "Select exactly one message to insert next to it.");
  const refocus = () =>
    restoreSelectFocus(
      () => registry.get(forkTranscriptEditSessionAtom(threadKey)).selection.anchor,
    );
  const upStep = needsPick === null ? bulkMoveStep(units, pickedSet, { direction: -1 }) : null;
  const downStep = needsPick === null ? bulkMoveStep(units, pickedSet, { direction: 1 }) : null;
  const add = (step: Omit<Step, "id"> | null) => {
    if (step !== null) actions.addStep(step);
    refocus();
  };

  const openInsert = (position: InsertTarget["position"]) => {
    const unitKey = picked[0];
    if (unitKey === undefined || session.load === null) return;
    const list = props.listRef.current;
    const rows = (list?.getState().data ?? []) as ReadonlyArray<MessagesTimelineRow>;
    const listIndex = timelineRowIndexForUnit(rows, session.load.links, unitKey);
    const rowId = forkTranscriptRowIdOfUnit(threadKey, unitKey) ?? rows[listIndex]?.id ?? null;
    if (rowId === null) {
      toastManager.add({ type: "info", title: "Scroll to the message, then try again." });
      return;
    }
    registry.set(forkTranscriptInsertTargetAtom(threadKey), { unitKey, rowId, position });
    const index = rows.findIndex((row) => row.id === rowId);
    if (list !== null && index >= 0) {
      void list.scrollToIndex({
        index,
        animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        viewPosition: 0.3,
      });
    }
  };

  return (
    <ComposerBanner.Body className="pt-1.5 pb-0.5">
      <div
        role="toolbar"
        aria-label="Selected messages"
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-border/60 pt-2"
        data-fork-transcript-select-bar=""
      >
        <span
          className={
            picked.length === 0
              ? "min-w-24 text-xs text-muted-foreground"
              : "min-w-24 text-xs font-medium text-foreground tabular-nums"
          }
          aria-live="polite"
          data-fork-transcript-select-count=""
        >
          {picked.length === 0 ? "None selected" : `${picked.length} of ${order.length} selected`}
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={order.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            actions.setSelection(allPicked ? emptySelection : selectAll(order));
            refocus();
          }}
        >
          {allPicked ? "Clear" : "Select all"}
        </Button>
        <Divider />
        <div className="flex items-center gap-0.5" role="group" aria-label="Move">
          <BarAction
            label="Move up"
            iconOnly
            shortcut="alt+arrowup"
            icon={<ArrowUpIcon aria-hidden="true" />}
            blockedBy={needsPick ?? (upStep === null ? "The selection is at the top." : null)}
            onClick={() => add(upStep)}
          />
          <BarAction
            label="Move down"
            iconOnly
            shortcut="alt+arrowdown"
            icon={<ArrowDownIcon aria-hidden="true" />}
            blockedBy={needsPick ?? (downStep === null ? "The selection is at the bottom." : null)}
            onClick={() => add(downStep)}
          />
          <BarAction
            label="Move to..."
            icon={<MoveVerticalIcon aria-hidden="true" />}
            blockedBy={needsPick}
            onClick={() => setMoveOpen(true)}
          />
        </div>
        <Divider />
        <div className="flex items-center gap-0.5" role="group" aria-label="Insert">
          <BarAction
            label="Insert above"
            iconOnly
            icon={<BetweenHorizontalStartIcon aria-hidden="true" />}
            blockedBy={needsOne}
            onClick={() => openInsert("above")}
          />
          <BarAction
            label="Insert below"
            iconOnly
            icon={<BetweenHorizontalEndIcon aria-hidden="true" />}
            blockedBy={needsOne}
            onClick={() => openInsert("below")}
          />
        </div>
        <Divider />
        <div className="flex items-center gap-0.5" role="group" aria-label="Remove">
          <BarAction
            label="Remove thinking"
            icon={<BrainIcon aria-hidden="true" />}
            blockedBy={
              needsPick ??
              (hasRemovableThinking(units, pickedSet)
                ? null
                : "The selected messages have no thinking blocks.")
            }
            onClick={() => add(bulkRemoveThinkingStep(units, pickedSet))}
          />
          <BarAction
            label="Delete"
            shortcut="delete"
            destructive
            icon={<Trash2Icon aria-hidden="true" />}
            blockedBy={needsPick}
            onClick={() => {
              deleteSelection(actions, units, session.selection);
              refocus();
            }}
          />
        </div>
        <Button
          size="xs"
          variant="outline"
          className="ms-auto"
          onClick={() => actions.setSelectMode(false)}
        >
          Done
        </Button>
        <ForkTranscriptMoveDialog
          open={moveOpen}
          units={units}
          selectedKeys={pickedSet}
          onOpenChange={setMoveOpen}
          onMove={(afterKey) => {
            setMoveOpen(false);
            add(bulkMoveStep(units, pickedSet, { afterKey }));
          }}
        />
      </div>
    </ComposerBanner.Body>
  );
}
