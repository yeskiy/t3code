/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { type RefObject, useContext, useState } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import {
  bulkMoveStep,
  bulkRemoveThinkingStep,
  deleteSelection,
  hasRemovableThinking,
  selectableUnitKeys,
} from "./bulkSteps.logic";
import { useForkTranscriptEditActions, useForkTranscriptEditSession } from "./editSession";
import type { Step } from "./history.logic";
import { ForkTranscriptMoveDialog } from "./ForkTranscriptMoveDialog";
import { forkTranscriptRowIdOfUnit } from "./ForkTranscriptRowCheckbox";
import { forkTranscriptInsertTargetAtom, type InsertTarget } from "./pendingState";
import { selectAll } from "./selection.logic";
import { timelineRowIndexForUnit } from "./stepRows.logic";

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
  const units = session.preview?.units ?? session.load?.units ?? [];
  const order = selectableUnitKeys(units);
  const picked = order.filter((key) => session.selection.keys.has(key));
  const pickedSet = new Set(picked);
  const none = picked.length === 0;
  const blocked = session.load === null || session.preview?.failedAt != null;
  const add = (step: Omit<Step, "id"> | null) => {
    if (step !== null) actions.addStep(step);
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
    <div
      role="toolbar"
      aria-label="Selected messages"
      className="flex flex-wrap items-center gap-1"
      data-fork-transcript-select-bar=""
    >
      <span className="me-1 text-xs font-medium tabular-nums" aria-live="polite">
        {`${picked.length} selected`}
      </span>
      <Button
        size="xs"
        variant="ghost-destructive"
        disabled={none || blocked}
        onClick={() => deleteSelection(actions, units, session.selection)}
      >
        Delete
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={none || blocked}
        onClick={() => add(bulkMoveStep(units, pickedSet, { direction: -1 }))}
      >
        Move up
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={none || blocked}
        onClick={() => add(bulkMoveStep(units, pickedSet, { direction: 1 }))}
      >
        Move down
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={none || blocked}
        onClick={() => setMoveOpen(true)}
      >
        Move to...
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={blocked || !hasRemovableThinking(units, pickedSet)}
        onClick={() => add(bulkRemoveThinkingStep(units, pickedSet))}
      >
        Remove thinking
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={picked.length !== 1 || blocked}
        onClick={() => openInsert("above")}
      >
        Insert before
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={picked.length !== 1 || blocked}
        onClick={() => openInsert("below")}
      >
        Insert after
      </Button>
      <span className="ms-auto flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={order.length === 0 || picked.length === order.length}
          onClick={() => actions.setSelection(selectAll(order))}
        >
          Select all
        </Button>
        <Button size="xs" variant="outline" onClick={() => actions.setSelectMode(false)}>
          Done
        </Button>
      </span>
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
  );
}
