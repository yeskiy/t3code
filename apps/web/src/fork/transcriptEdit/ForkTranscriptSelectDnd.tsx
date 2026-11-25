/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragOverEvent,
  type DragStartEvent,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/reactivity";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import {
  TimelineRowActivityCtx,
  type TimelineRowActivityState,
} from "~/components/chat/timelineRowContext";
import { useStableCallback } from "~/hooks/useStableCallback";
import { isEditableFocused } from "~/lib/editableFocus";
import { isMacPlatform } from "~/lib/utils";
import { bulkMoveStep, deleteSelection, dropAfterKey, selectableUnitKeys } from "./bulkSteps.logic";
import {
  createForkTranscriptEditActions,
  type ForkTranscriptEditSession,
  forkTranscriptEditSessionAtom,
} from "./editSession";
import { emptySelection, extendSelection, paintSelection, selectAll } from "./selection.logic";
import { useForkTranscriptEditEnabled } from "./transcriptEditSetting";

export interface DropTarget {
  readonly itemId: string;
  readonly side: "before" | "after";
}

export const forkTranscriptDropTargetAtom = Atom.make<DropTarget | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:transcript-edit:drop-target"),
);

export interface PaintStart {
  readonly keys: ReadonlyArray<string>;
  readonly mode: "add" | "remove";
  readonly element: HTMLElement;
}

export const ForkTranscriptSelectCtx = createContext<{
  readonly startPaint: (start: PaintStart) => void;
} | null>(null);

const KEYS_SELECTOR = "[data-fork-transcript-select-keys]";
const POPUP_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';
const EDGE_PX = 32;
const SCROLL_STEP_PX = 16;

const activeUnits = (session: ForkTranscriptEditSession) =>
  session.preview?.units ?? session.load?.units ?? [];

const keysOf = (element: Element) =>
  (element.getAttribute("data-fork-transcript-select-keys") ?? "")
    .split(" ")
    .filter((key) => key.length > 0);

const scrollParentOf = (element: HTMLElement | null): HTMLElement | null =>
  element === null
    ? null
    : /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight
      ? element
      : scrollParentOf(element.parentElement);

const pointerY = (event: Event | null) =>
  event instanceof MouseEvent || event instanceof PointerEvent ? event.clientY : 0;

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

const swallowClick = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/** Drag and drop, drag-to-select, and the timeline keys of the Select mode. */
function ForkTranscriptSelectProvider(props: {
  readonly threadKey: string;
  readonly viewport: HTMLElement | null;
  readonly children: ReactNode;
}) {
  const registry = useContext(RegistryContext);
  const [enabled] = useForkTranscriptEditEnabled();
  const atom = forkTranscriptEditSessionAtom(props.threadKey);
  const selectMode = useAtomValue(atom, (session) => session.selectMode) && enabled;
  const [dragCount, setDragCount] = useState(0);
  const dragKeys = useRef<ReadonlyArray<string>>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const actions = () =>
    createForkTranscriptEditActions({
      registry,
      threadKey: props.threadKey,
      threadRef: parseScopedThreadKey(props.threadKey),
    });
  const read = () => registry.get(atom);

  const startPaint = useStableCallback((start: PaintStart) => {
    const base = read().selection;
    const order = selectableUnitKeys(activeUnits(read()));
    const scroller = scrollParentOf(start.element);
    const state = { painted: false, x: 0, y: 0, frame: 0 };
    const paintAt = () => {
      const element = document.elementFromPoint(state.x, state.y)?.closest(KEYS_SELECTOR);
      if (element == null || (!state.painted && element === start.element)) return;
      state.painted = true;
      actions().setSelection(paintSelection(base, start.keys, keysOf(element), order, start.mode));
    };
    const onMove = (event: PointerEvent) => {
      state.x = event.clientX;
      state.y = event.clientY;
      paintAt();
    };
    // A drag near the top or bottom edge scrolls the list, and recycled rows join the paint.
    const tick = () => {
      const rect = scroller?.getBoundingClientRect();
      const dy =
        rect === undefined || !state.painted
          ? 0
          : state.y < rect.top + EDGE_PX
            ? -SCROLL_STEP_PX
            : state.y > rect.bottom - EDGE_PX
              ? SCROLL_STEP_PX
              : 0;
      if (dy !== 0) {
        scroller?.scrollBy(0, dy);
        paintAt();
      }
      state.frame = requestAnimationFrame(tick);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(state.frame);
      if (!state.painted) return;
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    state.frame = requestAnimationFrame(tick);
  });
  const [ctxValue] = useState(() => ({ startPaint }));

  const onSelectKey = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isEditableFocused(event.target)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(POPUP_SELECTOR) != null) return;
    const session = read();
    const units = activeUnits(session);
    const order = selectableUnitKeys(units);
    const mod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
    const plain = !mod && !event.altKey && !event.shiftKey;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : null;
    const run = (() => {
      if (event.key === "Escape" && plain) {
        return () =>
          session.selection.keys.size > 0
            ? actions().setSelection(emptySelection)
            : actions().setSelectMode(false);
      }
      if (target === null || props.viewport?.contains(target) !== true) return null;
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        return () => actions().setSelection(selectAll(order));
      }
      if (vertical !== null && event.shiftKey && !mod && !event.altKey) {
        return () => actions().setSelection(extendSelection(session.selection, vertical, order));
      }
      if (vertical !== null && event.altKey && !mod && !event.shiftKey) {
        const step = bulkMoveStep(units, session.selection.keys, { direction: vertical });
        return () => (step === null ? undefined : actions().addStep(step));
      }
      if (event.key === "Delete" && plain) {
        return () => deleteSelection(actions(), units, session.selection);
      }
      return null;
    })();
    if (run === null) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the Select mode keys only while the mode is on
  useEffect(() => {
    if (!selectMode) return;
    window.addEventListener("keydown", onSelectKey);
    return () => window.removeEventListener("keydown", onSelectKey);
  }, [selectMode, onSelectKey]);

  const clearDrop = () => {
    registry.set(forkTranscriptDropTargetAtom, null);
    setDragCount(0);
  };
  const onDragStart = ({ active }: DragStartEvent) => {
    const keys = (active.data.current?.keys ?? []) as ReadonlyArray<string>;
    const session = read();
    const moving = keys.some((key) => session.selection.keys.has(key))
      ? selectableUnitKeys(activeUnits(session)).filter((key) => session.selection.keys.has(key))
      : keys;
    if (moving === keys) actions().setSelection({ keys: new Set(keys), anchor: keys[0] ?? null });
    dragKeys.current = moving;
    setDragCount(moving.length);
  };
  const onDragMove = ({ over, activatorEvent, delta }: DragMoveEvent | DragOverEvent) => {
    const current = registry.get(forkTranscriptDropTargetAtom);
    if (over === null) {
      if (current !== null) registry.set(forkTranscriptDropTargetAtom, null);
      return;
    }
    const side =
      pointerY(activatorEvent) + delta.y < over.rect.top + over.rect.height / 2
        ? "before"
        : "after";
    if (current?.itemId !== String(over.id) || current.side !== side) {
      registry.set(forkTranscriptDropTargetAtom, { itemId: String(over.id), side });
    }
  };
  const onDragEnd = ({ over }: DragEndEvent) => {
    const drop = registry.get(forkTranscriptDropTargetAtom);
    clearDrop();
    if (over === null || drop === null || drop.itemId !== String(over.id)) return;
    const units = activeUnits(read());
    const targetKeys = ((over.data.current?.keys ?? []) as ReadonlyArray<string>).filter((key) =>
      units.some((unit) => unit.key === key),
    );
    if (targetKeys.length === 0) return;
    const step = bulkMoveStep(units, new Set(dragKeys.current), {
      afterKey: dropAfterKey(units, targetKeys, drop.side),
    });
    if (step !== null) actions().addStep(step);
  };

  return (
    <ForkTranscriptSelectCtx value={ctxValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={clearDrop}
      >
        {props.children}
        <DragOverlay dropAnimation={null}>
          {dragCount === 0 ? null : (
            <div className="w-max rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
              {dragCount === 1 ? "Moving 1 message" : `Moving ${dragCount} messages`}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </ForkTranscriptSelectCtx>
  );
}

/** The timeline activity context with the Select mode provider inside it. */
export function ForkTranscriptTimelineRoot(props: {
  readonly value: TimelineRowActivityState;
  readonly threadKey: string;
  readonly viewport: HTMLElement | null;
  readonly children: ReactNode;
}) {
  return (
    <TimelineRowActivityCtx value={props.value}>
      <ForkTranscriptSelectProvider threadKey={props.threadKey} viewport={props.viewport}>
        {props.children}
      </ForkTranscriptSelectProvider>
    </TimelineRowActivityCtx>
  );
}
