/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVerticalIcon } from "lucide-react";
import { use, useContext, type MouseEvent, type PointerEvent, type ReactNode } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Checkbox } from "~/components/ui/checkbox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { selectableUnitKeys } from "./bulkSteps.logic";
import { forkTranscriptEditSessionAtom, useForkTranscriptEditActions } from "./editSession";
import { forkTranscriptDropTargetAtom, ForkTranscriptSelectCtx } from "./ForkTranscriptSelectDnd";
import { pendingUnits } from "./pendingUnits.logic";
import { rangeSelectKeys, toggleKeys } from "./selection.logic";

const LOCKED_TOOLTIP = "This entry is locked. The session needs it.";
const INTERACTIVE =
  "a,button,input,textarea,select,summary,label,[role=button],[role=link],[role=checkbox],[contenteditable=true]";

// Rendered rows record the row of each unit, so "Insert before" can open its composer there.
const rowIdsByUnit = new Map<string, Map<string, string>>();
export const forkTranscriptRowIdOfUnit = (threadKey: string, unitKey: string): string | null =>
  rowIdsByUnit.get(threadKey)?.get(unitKey) ?? null;

export type SelectedState = "none" | "some" | "all";

/** The 28 px Select mode gutter with a checkbox and a drag grip, wrapped around one item. */
export function ForkTranscriptSelectable(props: {
  readonly active: boolean;
  readonly itemId: string;
  readonly rowId: string;
  readonly unitKeys: ReadonlyArray<string>;
  readonly selectableKeys: ReadonlyArray<string>;
  readonly selected: SelectedState;
  readonly children: ReactNode;
}) {
  const ctx = use(TimelineRowCtx);
  const select = use(ForkTranscriptSelectCtx);
  const registry = useContext(RegistryContext);
  const actions = useForkTranscriptEditActions(ctx.routeThreadKey, ctx.threadRef);
  const canSelect = props.active && props.selectableKeys.length > 0;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: props.itemId,
    data: { keys: props.selectableKeys },
    disabled: !canSelect,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: props.itemId,
    data: { keys: props.unitKeys },
    disabled: !props.active || props.unitKeys.length === 0,
  });
  const dropSide = useAtomValue(forkTranscriptDropTargetAtom, (target) =>
    target?.itemId === props.itemId ? target.side : null,
  );
  if (canSelect) {
    const byUnit = rowIdsByUnit.get(ctx.routeThreadKey) ?? new Map<string, string>();
    props.selectableKeys.forEach((key) => byUnit.set(key, props.rowId));
    rowIdsByUnit.set(ctx.routeThreadKey, byUnit);
  }

  const toggle = (shift: boolean) => {
    const session = registry.get(forkTranscriptEditSessionAtom(ctx.routeThreadKey));
    const order = selectableUnitKeys(
      pendingUnits(session) ?? session.preview?.units ?? session.load?.units ?? [],
    );
    actions.setSelection(
      shift
        ? rangeSelectKeys(session.selection, props.selectableKeys, order)
        : toggleKeys(session.selection, props.selectableKeys),
    );
  };
  const onContentClick = (event: MouseEvent<HTMLDivElement>) => {
    const hit = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
    if (hit !== null && event.currentTarget.contains(hit)) return;
    if (!event.shiftKey && (window.getSelection()?.toString() ?? "").length > 0) return;
    toggle(event.shiftKey);
  };
  // Shift+click extends a range of rows, so it must not start a text selection.
  const onRowMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.shiftKey) event.preventDefault();
  };
  const onCheckboxPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    const element = event.currentTarget.closest<HTMLElement>("[data-fork-transcript-select-keys]");
    if (event.button !== 0 || element === null || select === null) return;
    select.startPaint({
      keys: props.selectableKeys,
      mode: props.selected === "all" ? "remove" : "add",
      element,
    });
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropNodeRef(node);
      }}
      className={
        props.active
          ? cn(
              "group/select relative flex rounded-lg",
              props.selected !== "none" && "bg-accent",
              isDragging && "opacity-50",
            )
          : "contents"
      }
      data-fork-transcript-select-keys={canSelect ? props.selectableKeys.join(" ") : undefined}
      data-selected={props.active ? String(props.selected !== "none") : undefined}
      onMouseDown={canSelect ? onRowMouseDown : undefined}
    >
      {props.active ? (
        <div className="flex w-7 shrink-0 flex-col items-center gap-1 pt-1.5">
          {canSelect ? (
            <>
              <span className="flex" onPointerDown={onCheckboxPointerDown}>
                <Checkbox
                  aria-label="Select this entry"
                  data-fork-transcript-select-checkbox=""
                  checked={props.selected === "all"}
                  indeterminate={props.selected === "some"}
                  onClick={(event) => toggle(event.shiftKey)}
                />
              </span>
              <button
                type="button"
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                aria-label="Drag to move"
                data-fork-transcript-drag-handle=""
                className="flex h-5 w-4 cursor-grab touch-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/select:opacity-100 group-data-[selected=true]/select:opacity-100 focus-visible:opacity-100 active:cursor-grabbing motion-reduce:transition-none"
              >
                <GripVerticalIcon aria-hidden="true" className="size-3.5" />
              </button>
            </>
          ) : props.unitKeys.length > 0 ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex" />}>
                <Checkbox aria-label="Locked entry" checked={false} disabled />
              </TooltipTrigger>
              <TooltipPopup side="top">{LOCKED_TOOLTIP}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      <div
        className={props.active ? "min-w-0 flex-1" : "contents"}
        data-fork-transcript-select-content=""
        onClick={canSelect ? onContentClick : undefined}
      >
        {props.children}
      </div>
      {dropSide === null ? null : (
        <div
          aria-hidden="true"
          data-fork-transcript-drop-line=""
          data-side={dropSide}
          className={cn(
            "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary",
            dropSide === "before" ? "-top-px" : "-bottom-px",
          )}
        />
      )}
    </div>
  );
}
