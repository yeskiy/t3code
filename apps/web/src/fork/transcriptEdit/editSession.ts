import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ForkTranscriptEditError,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPendingOp,
  type ForkTranscriptPreviewResult,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import { Atom, type AtomRegistry } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useContext } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { registerThreadOverlay } from "~/components/chat/threadOverlayRetention";
import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  emptyHistory,
  flatOps,
  type History,
  type HistoryAction,
  historyReducer,
  type Step,
} from "./history.logic";
import { type DraftAnchor, draftAnchors, type UnitChange, unitChanges } from "./rowChanges.logic";
import { rowItemIds } from "./rowUnits.logic";
import { emptySelection, pruneSelection, type Selection } from "./selection.logic";
import { forkTranscriptLoad, forkTranscriptPreview } from "./transcriptEditRpc";

export interface ForkTranscriptEditSession {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly error: ForkTranscriptEditError | null;
  readonly load: ForkTranscriptLoadResult | null;
  readonly history: History;
  readonly preview: ForkTranscriptPreviewResult | null;
  readonly openUnitKeys: ReadonlySet<string>;
  readonly openRowIds: ReadonlySet<string>;
  readonly selectMode: boolean;
  readonly selection: Selection;
  readonly after: "idle" | "continue";
}

export interface ForkTranscriptEditActions {
  readonly ensureLoaded: () => Promise<void>;
  readonly openUnit: (unitKey: string, rowId: string) => void;
  readonly closeUnit: (unitKey: string, rowId: string) => void;
  readonly addStep: (step: Omit<Step, "id">) => void;
  readonly dispatchHistory: (action: HistoryAction) => void;
  readonly setSelectMode: (on: boolean) => void;
  readonly setSelection: (next: Selection) => void;
  readonly setAfter: (after: "idle" | "continue") => void;
  readonly reload: (keepChanges: boolean) => Promise<ReadonlyArray<Step>>;
  readonly discard: () => void;
}

export interface ForkTranscriptRowState {
  readonly unitKeys: ReadonlyArray<string>;
  readonly open: boolean;
  readonly selectMode: boolean;
  readonly selected: "none" | "some" | "all";
  readonly change: UnitChange | null;
  readonly inherited: boolean;
  readonly drafts: ReadonlyArray<DraftAnchor>;
}

const PREVIEW_DEBOUNCE_MS = 150;
const EMPTY_STRING_SET: ReadonlySet<string> = new Set();
const EMPTY_STRING_ARRAY: ReadonlyArray<string> = [];
const EMPTY_DRAFT_ARRAY: ReadonlyArray<DraftAnchor> = [];

export const emptyEditSession: ForkTranscriptEditSession = {
  status: "idle",
  error: null,
  load: null,
  history: emptyHistory,
  preview: null,
  openUnitKeys: EMPTY_STRING_SET,
  openRowIds: EMPTY_STRING_SET,
  selectMode: false,
  selection: emptySelection,
  after: "continue",
};

const EMPTY_ROW_STATE: ForkTranscriptRowState = {
  unitKeys: EMPTY_STRING_ARRAY,
  open: false,
  selectMode: false,
  selected: "none",
  change: null,
  inherited: false,
  drafts: EMPTY_DRAFT_ARRAY,
};

const IDLE_SESSION_ATOM = Atom.make(emptyEditSession).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:transcript-edit:idle"),
);

// Strong refs keep per-thread atoms alive across route switches until discard or reload.
const trackedSessions = new Map<string, Atom.Writable<ForkTranscriptEditSession>>();
const openRowByUnitByThread = new Map<string, Map<string, string>>();
const inFlightLoads = new Map<string, Promise<void>>();
const previewControllers = new Map<
  string,
  { readonly timer: ReturnType<typeof setTimeout> | null; readonly seq: number }
>();

const sessionFamily = Atom.family((threadKey: string) =>
  Atom.make<ForkTranscriptEditSession>(emptyEditSession).pipe(
    Atom.keepAlive,
    Atom.withLabel(`fork:transcript-edit:${threadKey}`),
  ),
);

export const forkTranscriptEditSessionAtom = (
  threadKey: string,
): Atom.Writable<ForkTranscriptEditSession> => {
  const existing = trackedSessions.get(threadKey);
  if (existing !== undefined) return existing;
  const atom = sessionFamily(threadKey);
  trackedSessions.set(threadKey, atom);
  return atom;
};

registerThreadOverlay((activeThreadKey) => {
  trackedSessions.forEach((atom, threadKey) => {
    if (threadKey === activeThreadKey) return;
    openRowByUnitByThread.delete(threadKey);
    const current = appAtomRegistry.get(atom);
    if (
      !current.selectMode &&
      current.selection.keys.size === 0 &&
      current.selection.anchor === null &&
      current.openUnitKeys.size === 0 &&
      current.openRowIds.size === 0
    ) {
      return;
    }
    appAtomRegistry.set(atom, {
      ...current,
      selectMode: false,
      selection: emptySelection,
      openUnitKeys: EMPTY_STRING_SET,
      openRowIds: EMPTY_STRING_SET,
    });
  });
});

interface SessionIndex {
  readonly unitKeyByItemId: ReadonlyMap<string, string>;
  readonly inheritedItemIds: ReadonlySet<string>;
  readonly changes: ReadonlyMap<string, UnitChange>;
  readonly draftsByAfterKey: ReadonlyMap<string | null, ReadonlyArray<DraftAnchor>>;
  readonly firstLinkedUnitKey: string | null;
}

const sessionIndexCache = new WeakMap<ForkTranscriptEditSession, SessionIndex>();

const buildSessionIndex = (session: ForkTranscriptEditSession): SessionIndex => {
  const cached = sessionIndexCache.get(session);
  if (cached !== undefined) return cached;

  const links = session.load?.links ?? [];
  const unitKeyByItemId = new Map(links.map((link) => [link.itemId, link.unitKey] as const));
  const inheritedItemIds = new Set(links.flatMap((link) => (link.inherited ? [link.itemId] : [])));
  const linkedUnitKeys = new Set(links.map((link) => link.unitKey));
  const changes = unitChanges(session.preview?.diff ?? []);
  const activeUnits = session.preview?.units ?? session.load?.units ?? [];
  const anchors =
    session.status === "ready" && session.load !== null
      ? draftAnchors({ preview: activeUnits, linkedUnitKeys, changes })
      : EMPTY_DRAFT_ARRAY;

  const draftsByAfterKey = new Map<string | null, Array<DraftAnchor>>();
  anchors.forEach((anchor) => {
    const bucket = draftsByAfterKey.get(anchor.afterUnitKey);
    if (bucket === undefined) {
      draftsByAfterKey.set(anchor.afterUnitKey, [anchor]);
    } else {
      bucket.push(anchor);
    }
  });

  const firstLinkedUnitKey =
    activeUnits.find((unit) => {
      if (!linkedUnitKeys.has(unit.key)) return false;
      const change = changes.get(unit.key);
      return change !== "moved" && change !== "movedEdited" && change !== "inserted";
    })?.key ?? null;

  const index: SessionIndex = {
    unitKeyByItemId,
    inheritedItemIds,
    changes,
    draftsByAfterKey,
    firstLinkedUnitKey,
  };
  sessionIndexCache.set(session, index);
  return index;
};

const selectRowStateFromItemIds = (
  session: ForkTranscriptEditSession,
  itemIds: ReadonlyArray<string>,
): ForkTranscriptRowState => {
  if (session.status === "idle" && !session.selectMode && session.load === null) {
    return EMPTY_ROW_STATE;
  }
  const index = buildSessionIndex(session);
  const unitKeys = [
    ...new Set(
      itemIds.flatMap((itemId) => {
        const key = index.unitKeyByItemId.get(itemId);
        return key === undefined ? [] : [key];
      }),
    ),
  ];

  const open = unitKeys.some((key) => session.openUnitKeys.has(key));
  const selectedCount = unitKeys.filter((key) => session.selection.keys.has(key)).length;
  const selected: ForkTranscriptRowState["selected"] =
    selectedCount === 0 ? "none" : selectedCount === unitKeys.length ? "all" : "some";

  const unitChangeList = unitKeys.map((key) => index.changes.get(key) ?? null);
  const change: UnitChange | null =
    unitKeys.length === 0
      ? null
      : unitKeys.length === 1
        ? (unitChangeList[0] ?? null)
        : unitChangeList.every((item) => item === "removed")
          ? "removed"
          : (unitChangeList.find((item) => item !== null && item !== "removed") ??
            (unitChangeList.some((item) => item === "removed") ? "edited" : null));

  const inherited = itemIds.some((itemId) => index.inheritedItemIds.has(itemId));
  const leadingDrafts =
    index.firstLinkedUnitKey !== null && unitKeys.includes(index.firstLinkedUnitKey)
      ? (index.draftsByAfterKey.get(null) ?? EMPTY_DRAFT_ARRAY)
      : EMPTY_DRAFT_ARRAY;
  const trailingDrafts = unitKeys.flatMap(
    (key) => index.draftsByAfterKey.get(key) ?? EMPTY_DRAFT_ARRAY,
  );
  const drafts =
    leadingDrafts.length === 0
      ? trailingDrafts
      : trailingDrafts.length === 0
        ? leadingDrafts
        : [...leadingDrafts, ...trailingDrafts];

  return {
    unitKeys,
    open,
    selectMode: session.selectMode,
    selected,
    change,
    inherited,
    drafts,
  };
};

export const selectRowState = (
  session: ForkTranscriptEditSession,
  row: MessagesTimelineRow,
): ForkTranscriptRowState => selectRowStateFromItemIds(session, rowItemIds(row));

const sameStrings = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const sameDrafts = (a: ReadonlyArray<DraftAnchor>, b: ReadonlyArray<DraftAnchor>): boolean =>
  a.length === b.length &&
  a.every(
    (draft, index) =>
      draft.afterUnitKey === b[index]?.afterUnitKey &&
      draft.change === b[index]?.change &&
      draft.unit === b[index]?.unit,
  );

export const rowStateEqual = (a: ForkTranscriptRowState, b: ForkTranscriptRowState): boolean =>
  a === b ||
  (a.open === b.open &&
    a.selectMode === b.selectMode &&
    a.selected === b.selected &&
    a.change === b.change &&
    a.inherited === b.inherited &&
    sameStrings(a.unitKeys, b.unitKeys) &&
    sameDrafts(a.drafts, b.drafts));

const EMPTY_ROW_STATE_ATOM = Atom.make(EMPTY_ROW_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:transcript-edit:row:empty"),
);

const rowStateAtomFamily = Atom.family((compositeKey: string) => {
  const separatorIndex = compositeKey.indexOf("\0");
  const threadKey = compositeKey.slice(0, separatorIndex);
  const rawIds = compositeKey.slice(separatorIndex + 1);
  const itemIds = rawIds.length === 0 ? EMPTY_STRING_ARRAY : rawIds.split("\u0001");
  const sessionAtom = forkTranscriptEditSessionAtom(threadKey);
  return Atom.make((get) => selectRowStateFromItemIds(get(sessionAtom), itemIds)).pipe(
    Atom.withEquality(rowStateEqual),
    Atom.withLabel(`fork:transcript-edit:row:${threadKey}`),
  );
});

export const useForkTranscriptEditSession = (threadKey: string | null): ForkTranscriptEditSession =>
  useAtomValue(threadKey === null ? IDLE_SESSION_ATOM : forkTranscriptEditSessionAtom(threadKey));

export const useForkTranscriptRowState = (
  threadKey: string | null,
  row: MessagesTimelineRow,
): ForkTranscriptRowState => {
  const itemIds = rowItemIds(row);
  const atom =
    threadKey === null
      ? EMPTY_ROW_STATE_ATOM
      : rowStateAtomFamily(`${threadKey}\0${itemIds.join("\u0001")}`);
  return useAtomValue(atom);
};

const isForkTranscriptEditError = Schema.is(ForkTranscriptEditError);

export const toEditError = (
  cause: Cause.Cause<unknown>,
  fallbackCode: ForkTranscriptEditError["code"],
): ForkTranscriptEditError => {
  const squashed = squashAtomCommandFailure({ cause });
  if (isForkTranscriptEditError(squashed)) return squashed;
  const detail = squashed instanceof Error ? squashed.message : String(squashed);
  return new ForkTranscriptEditError({ code: fallbackCode, detail });
};

const bumpPreviewSeq = (threadKey: string): number => {
  const previous = previewControllers.get(threadKey);
  if (previous?.timer !== null && previous !== undefined) {
    clearTimeout(previous.timer);
  }
  const nextSeq = (previous?.seq ?? 0) + 1;
  previewControllers.set(threadKey, { timer: null, seq: nextSeq });
  return nextSeq;
};

const findStepIndexForOp = (steps: ReadonlyArray<Step>, opIndex: number): number =>
  steps.reduce<{ readonly offset: number; readonly found: number }>(
    (acc, step, index) => {
      if (acc.found !== -1) return acc;
      const end = acc.offset + step.items.length;
      return opIndex < end ? { offset: end, found: index } : { offset: end, found: -1 };
    },
    { offset: 0, found: -1 },
  ).found;

interface EditSessionRpcClients {
  readonly load: (
    threadRef: ScopedThreadRef,
  ) => Promise<AtomCommandResult<ForkTranscriptLoadResult, unknown>>;
  readonly preview: (
    threadRef: ScopedThreadRef,
    baseKey: string,
    ops: ReadonlyArray<ForkTranscriptPendingOp>,
  ) => Promise<AtomCommandResult<ForkTranscriptPreviewResult, unknown>>;
}

const defaultRpcClients = (registry: AtomRegistry.AtomRegistry): EditSessionRpcClients => ({
  load: (threadRef) =>
    runAtomCommand(
      registry,
      forkTranscriptLoad,
      { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId } },
      { reportFailure: false, reportDefect: false },
    ),
  preview: (threadRef, baseKey, ops) =>
    runAtomCommand(
      registry,
      forkTranscriptPreview,
      {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, baseKey, ops },
      },
      { reportFailure: false, reportDefect: false },
    ),
});

const NOOP_ACTIONS: ForkTranscriptEditActions = {
  ensureLoaded: () => Promise.resolve(),
  openUnit: () => {},
  closeUnit: () => {},
  addStep: () => {},
  dispatchHistory: () => {},
  setSelectMode: () => {},
  setSelection: () => {},
  setAfter: () => {},
  reload: () => Promise.resolve([]),
  discard: () => {},
};

export const createForkTranscriptEditActions = (input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly threadKey: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly rpc?: EditSessionRpcClients;
  readonly debounceMs?: number;
}): ForkTranscriptEditActions => {
  const { registry, threadKey, threadRef } = input;
  if (threadKey === null) return NOOP_ACTIONS;

  const atom = forkTranscriptEditSessionAtom(threadKey);
  const rpc = input.rpc ?? defaultRpcClients(registry);
  const debounceMs = input.debounceMs ?? PREVIEW_DEBOUNCE_MS;

  const update = (fn: (current: ForkTranscriptEditSession) => ForkTranscriptEditSession): void => {
    const current = registry.get(atom);
    const next = fn(current);
    if (next !== current) {
      registry.set(atom, next);
    }
  };

  const schedulePreview = (): void => {
    const seq = bumpPreviewSeq(threadKey);
    const current = registry.get(atom);
    if (current.history.steps.length === 0) {
      if (current.preview !== null) {
        update((session) => ({ ...session, preview: null }));
      }
      return;
    }
    if (current.load === null || threadRef === null) return;

    const timer = setTimeout(() => {
      const active = previewControllers.get(threadKey);
      if (active?.seq !== seq) return;
      const latest = registry.get(atom);
      if (latest.load === null || latest.history.steps.length === 0) return;

      const ops = flatOps(latest.history);
      void rpc.preview(threadRef, latest.load.baseKey, ops).then((result) => {
        if (previewControllers.get(threadKey)?.seq !== seq) return;
        if (result._tag === "Success") {
          update((session) => {
            const nextSelection =
              result.value.failedAt === null && session.selection.keys.size > 0
                ? pruneSelection(
                    session.selection,
                    result.value.units.map((unit) => unit.key),
                  )
                : session.selection;
            return {
              ...session,
              preview: result.value,
              error: null,
              selection: nextSelection,
            };
          });
          return;
        }
        update((session) => ({
          ...session,
          error: toEditError(result.cause, "stale"),
        }));
      });
    }, debounceMs);

    previewControllers.set(threadKey, { timer, seq });
  };

  const ensureLoaded = (): Promise<void> => {
    if (threadRef === null) return Promise.resolve();
    const current = registry.get(atom);
    if (current.status === "ready" && current.load !== null) {
      return Promise.resolve();
    }
    const existingFlight = inFlightLoads.get(threadKey);
    if (existingFlight !== undefined) return existingFlight;

    update((session) => ({ ...session, status: "loading", error: null }));
    const flight = rpc
      .load(threadRef)
      .then((result) => {
        if (result._tag === "Success") {
          update((session) => ({
            ...session,
            status: "ready",
            error: null,
            load: result.value,
          }));
          if (registry.get(atom).history.steps.length > 0) {
            schedulePreview();
          }
          return;
        }
        update((session) => ({
          ...session,
          status: "error",
          error: toEditError(result.cause, "no-session-file"),
        }));
      })
      .finally(() => {
        if (inFlightLoads.get(threadKey) === flight) {
          inFlightLoads.delete(threadKey);
        }
      });

    inFlightLoads.set(threadKey, flight);
    return flight;
  };

  const replaySteps = async (
    ref: ScopedThreadRef,
    baseKey: string,
    remaining: ReadonlyArray<Step>,
    dropped: ReadonlyArray<Step>,
  ): Promise<{
    readonly kept: ReadonlyArray<Step>;
    readonly dropped: ReadonlyArray<Step>;
    readonly preview: ForkTranscriptPreviewResult | null;
  }> => {
    if (remaining.length === 0) {
      return { kept: [], dropped, preview: null };
    }
    const result = await rpc.preview(ref, baseKey, flatOps({ steps: remaining, redo: [] }));
    if (result._tag === "Failure") {
      return { kept: [], dropped: [...dropped, ...remaining], preview: null };
    }
    const failedAt = result.value.failedAt;
    if (failedAt === null) {
      return { kept: remaining, dropped, preview: result.value };
    }
    const failedStepIndex = findStepIndexForOp(remaining, failedAt.index);
    if (failedStepIndex < 0) {
      return { kept: [], dropped: [...dropped, ...remaining], preview: null };
    }
    const failedStep = remaining[failedStepIndex];
    const nextRemaining = remaining.filter((_, index) => index !== failedStepIndex);
    const nextDropped = failedStep === undefined ? dropped : [...dropped, failedStep];
    return replaySteps(ref, baseKey, nextRemaining, nextDropped);
  };

  const dispatchHistory = (action: HistoryAction): void => {
    const current = registry.get(atom);
    const nextHistory = historyReducer(current.history, action);
    if (nextHistory === current.history) return;
    registry.set(atom, {
      ...current,
      history: nextHistory,
      preview: nextHistory.steps.length === 0 ? null : current.preview,
    });
    schedulePreview();
  };

  return {
    ensureLoaded,

    openUnit: (unitKey, rowId) => {
      const existingMap = openRowByUnitByThread.get(threadKey) ?? new Map<string, string>();
      const nextMap = new Map(existingMap);
      nextMap.set(unitKey, rowId);
      openRowByUnitByThread.set(threadKey, nextMap);
      update((session) => ({
        ...session,
        openUnitKeys: new Set(nextMap.keys()),
        openRowIds: new Set(nextMap.values()),
      }));
    },

    closeUnit: (unitKey, rowId) => {
      const existingMap = openRowByUnitByThread.get(threadKey);
      if (existingMap !== undefined) {
        const nextMap = new Map(existingMap);
        nextMap.delete(unitKey);
        if (nextMap.size === 0) {
          openRowByUnitByThread.delete(threadKey);
        } else {
          openRowByUnitByThread.set(threadKey, nextMap);
        }
        update((session) => ({
          ...session,
          openUnitKeys: nextMap.size === 0 ? EMPTY_STRING_SET : new Set(nextMap.keys()),
          openRowIds: nextMap.size === 0 ? EMPTY_STRING_SET : new Set(nextMap.values()),
        }));
        return;
      }
      update((session) => {
        const nextUnits = new Set(session.openUnitKeys);
        nextUnits.delete(unitKey);
        const nextRows = new Set(session.openRowIds);
        nextRows.delete(rowId);
        return { ...session, openUnitKeys: nextUnits, openRowIds: nextRows };
      });
    },

    addStep: (step) => {
      dispatchHistory({ type: "add", step: { ...step, id: randomUUID() } });
    },

    dispatchHistory,

    setSelectMode: (on) => {
      update((session) => ({
        ...session,
        selectMode: on,
        selection: on ? session.selection : emptySelection,
      }));
    },

    setSelection: (next) => {
      update((session) => ({ ...session, selection: next }));
    },

    setAfter: (after) => {
      update((session) => ({ ...session, after }));
    },

    reload: async (keepChanges) => {
      if (threadRef === null) return [];
      const seq = bumpPreviewSeq(threadKey);
      openRowByUnitByThread.delete(threadKey);
      const priorSteps = registry.get(atom).history.steps;
      update((session) => ({ ...session, status: "loading", error: null }));

      const loaded = await rpc.load(threadRef);
      if (previewControllers.get(threadKey)?.seq !== seq) return [];
      if (loaded._tag === "Failure") {
        update((session) => ({
          ...session,
          status: "error",
          error: toEditError(loaded.cause, "no-session-file"),
        }));
        return [];
      }

      if (!keepChanges || priorSteps.length === 0) {
        update((session) => ({
          ...session,
          status: "ready",
          error: null,
          load: loaded.value,
          history: emptyHistory,
          preview: null,
          openUnitKeys: EMPTY_STRING_SET,
          openRowIds: EMPTY_STRING_SET,
          selection: emptySelection,
        }));
        return [];
      }

      const replayed = await replaySteps(threadRef, loaded.value.baseKey, priorSteps, []);
      if (previewControllers.get(threadKey)?.seq !== seq) return [];
      const activeUnits = replayed.preview?.units ?? loaded.value.units;
      update((session) => ({
        ...session,
        status: "ready",
        error: null,
        load: loaded.value,
        history: { steps: replayed.kept, redo: [] },
        preview: replayed.preview,
        openUnitKeys: EMPTY_STRING_SET,
        openRowIds: EMPTY_STRING_SET,
        selection: pruneSelection(
          session.selection,
          activeUnits.map((unit) => unit.key),
        ),
      }));
      return replayed.dropped;
    },

    discard: () => {
      bumpPreviewSeq(threadKey);
      openRowByUnitByThread.delete(threadKey);
      registry.set(atom, emptyEditSession);
    },
  };
};

export const useForkTranscriptEditActions = (
  threadKey: string | null,
  threadRef: ScopedThreadRef | null,
): ForkTranscriptEditActions => {
  const registry = useContext(RegistryContext);
  return createForkTranscriptEditActions({ registry, threadKey, threadRef });
};
