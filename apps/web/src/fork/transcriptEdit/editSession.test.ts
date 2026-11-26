import {
  EnvironmentId,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPendingOp,
  type ForkTranscriptPreviewResult,
  type ForkTranscriptUnitView,
  type OrchestrationV2ProjectedTurnItem,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { retainThreadOverlaysForThread } from "~/components/chat/threadOverlayRetention";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  createForkTranscriptEditActions,
  emptyEditSession,
  forkTranscriptEditSessionAtom,
  type ForkTranscriptEditSession,
  rowStateEqual,
  selectRowState,
} from "./editSession";
import { emptyHistory } from "./history.logic";
import { toggleSelect } from "./selection.logic";
import { readForkTranscriptShortcutContext } from "./transcriptEditShortcuts";

const unit = (
  key: string,
  kind: ForkTranscriptUnitView["kind"] = "user",
): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: "2026-11-25T10:00:00.000Z",
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: key,
});

const messageRow = (id: string, itemId: string): MessagesTimelineRow =>
  ({
    kind: "message",
    id,
    createdAt: "2026-11-25T10:00:00.000Z",
    projectedItem: { item: { id: itemId } } as unknown as OrchestrationV2ProjectedTurnItem,
  }) as unknown as MessagesTimelineRow;

const loadResult: ForkTranscriptLoadResult = {
  sessionId: "sess-1",
  baseKey: "key-1",
  units: [unit("sys0", "system"), unit("u1", "user"), unit("a1", "assistant")],
  links: [
    { itemId: "item-u1", unitKey: "u1", inherited: false },
    { itemId: "item-a1", unitKey: "a1", inherited: true },
  ],
  compactionItemId: null,
  validation: { errors: [], warnings: [] },
  live: { editable: true, reason: null, working: false },
};

describe("editSession", () => {
  it("keeps pending changes across a thread switch while clearing view state", () => {
    const atom = forkTranscriptEditSessionAtom("env:thread-switch-test");
    const withChanges: ForkTranscriptEditSession = {
      ...emptyEditSession,
      status: "ready",
      load: loadResult,
      history: {
        steps: [
          {
            id: "s1",
            label: "Edited",
            unitKeys: ["u1"],
            items: [
              {
                op: { kind: "editUserText", uuid: "u1", block: null, text: "next" },
                at: "2026-11-25T10:01:00.000Z",
              },
            ],
          },
        ],
        redo: [],
      },
      openUnitKeys: new Set(["u1"]),
      openRowIds: new Set(["row-u1"]),
      selectMode: true,
      selection: toggleSelect({ keys: new Set(), anchor: null }, "u1"),
    };

    appAtomRegistry.set(atom, withChanges);
    retainThreadOverlaysForThread("env:other-thread");

    const afterSwitch = appAtomRegistry.get(atom);
    expect(afterSwitch.history.steps).toHaveLength(1);
    expect(afterSwitch.load).toBe(loadResult);
    expect(afterSwitch.selectMode).toBe(false);
    expect(afterSwitch.selection.keys.size).toBe(0);
    expect(afterSwitch.openUnitKeys.size).toBe(0);
    expect(afterSwitch.openRowIds.size).toBe(0);

    appAtomRegistry.set(atom, emptyEditSession);
  });

  it("derives per-row state with drafts, inheritance, selection, and change status", () => {
    const preview: ForkTranscriptPreviewResult = {
      units: [
        unit("sys0", "system"),
        unit("u1", "user"),
        unit("ins1", "assistant"),
        unit("a1", "assistant"),
      ],
      validation: { errors: [], warnings: [] },
      diff: [
        { key: "u1", kind: "user", status: "changed", before: "old", after: "new" },
        { key: "ins1", kind: "assistant", status: "added", before: null, after: "added" },
      ],
      failedAt: null,
    };

    const session: ForkTranscriptEditSession = {
      ...emptyEditSession,
      status: "ready",
      load: loadResult,
      history: emptyHistory,
      preview,
      openUnitKeys: new Set(["u1"]),
      openRowIds: new Set(["row-u1"]),
      selectMode: true,
      selection: toggleSelect({ keys: new Set(), anchor: null }, "u1"),
    };

    const u1State = selectRowState(session, messageRow("row-u1", "item-u1"));
    expect(u1State.unitKeys).toEqual(["u1"]);
    expect(u1State.open).toBe(true);
    expect(u1State.selectMode).toBe(true);
    expect(u1State.selected).toBe("all");
    expect(u1State.change).toBe("edited");
    expect(u1State.inherited).toBe(false);
    expect(u1State.drafts).toEqual([
      { afterUnitKey: null, unit: preview.units[0], change: "fileOnly" },
      { afterUnitKey: "u1", unit: preview.units[2], change: "inserted" },
    ]);

    const a1State = selectRowState(session, messageRow("row-a1", "item-a1"));
    expect(a1State.unitKeys).toEqual(["a1"]);
    expect(a1State.open).toBe(false);
    expect(a1State.selected).toBe("none");
    expect(a1State.change).toBeNull();
    expect(a1State.inherited).toBe(true);
    expect(a1State.drafts).toEqual([]);

    // Structural equality holds for an unchanged row when another row opens.
    const nextSession: ForkTranscriptEditSession = {
      ...session,
      openUnitKeys: new Set(["u1", "ins1"]),
    };
    expect(
      rowStateEqual(a1State, selectRowState(nextSession, messageRow("row-a1", "item-a1"))),
    ).toBe(true);
  });

  it("deduplicates concurrent ensureLoaded calls and stores the load result", async () => {
    const registry = AtomRegistry.make();
    const threadKey = "env:load-dedupe";
    const threadRef: ScopedThreadRef = {
      environmentId: EnvironmentId.make("env"),
      threadId: ThreadId.make("load-dedupe"),
    };
    const loadCalls: Array<ScopedThreadRef> = [];
    const deferred: { resolve?: () => void } = {};
    const gate = new Promise<void>((resolve) => {
      deferred.resolve = resolve;
    });

    const actions = createForkTranscriptEditActions({
      registry,
      threadKey,
      threadRef,
      rpc: {
        load: async (ref) => {
          loadCalls.push(ref);
          await gate;
          return AsyncResult.success(loadResult);
        },
        preview: async () =>
          AsyncResult.success({
            units: loadResult.units,
            validation: { errors: [], warnings: [] },
            diff: [],
            failedAt: null,
          }),
      },
    });

    const first = actions.ensureLoaded();
    const second = actions.ensureLoaded();
    expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).status).toBe("loading");

    deferred.resolve?.();
    await Promise.all([first, second]);

    expect(loadCalls).toHaveLength(1);
    const loaded = registry.get(forkTranscriptEditSessionAtom(threadKey));
    expect(loaded.status).toBe("ready");
    expect(loaded.load).toBe(loadResult);

    // Calling again once ready is a no-op.
    await actions.ensureLoaded();
    expect(loadCalls).toHaveLength(1);
  });

  it("debounces preview by 150 ms, keeps last good preview, and clears on empty history", async () => {
    vi.useFakeTimers();
    try {
      const registry = AtomRegistry.make();
      const threadKey = "env:preview-debounce";
      const threadRef: ScopedThreadRef = {
        environmentId: EnvironmentId.make("env"),
        threadId: ThreadId.make("preview-debounce"),
      };
      const previewCalls: Array<ReadonlyArray<ForkTranscriptPendingOp>> = [];
      const previewOne: ForkTranscriptPreviewResult = {
        units: loadResult.units,
        validation: { errors: [], warnings: [] },
        diff: [{ key: "u1", kind: "user", status: "changed", before: "a", after: "b" }],
        failedAt: null,
      };
      const actions = createForkTranscriptEditActions({
        registry,
        threadKey,
        threadRef,
        rpc: {
          load: async () => AsyncResult.success(loadResult),
          preview: async (_ref, _baseKey, ops) => {
            previewCalls.push(ops);
            return AsyncResult.success(previewOne);
          },
        },
      });

      await actions.ensureLoaded();
      actions.addStep({
        label: "Edit 1",
        unitKeys: ["u1"],
        items: [
          {
            op: { kind: "editUserText", uuid: "u1", block: null, text: "first" },
            at: "2026-11-25T10:01:00.000Z",
          },
        ],
      });
      actions.addStep({
        label: "Edit 2",
        unitKeys: ["u1"],
        items: [
          {
            op: { kind: "editUserText", uuid: "u1", block: null, text: "second" },
            at: "2026-11-25T10:02:00.000Z",
          },
        ],
      });

      await vi.advanceTimersByTimeAsync(149);
      expect(previewCalls).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(previewCalls).toHaveLength(1);
      expect(previewCalls[0]).toHaveLength(2);
      expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).preview).toBe(previewOne);

      // Undo back to 1 step keeps last good preview while waiting for debounce.
      actions.dispatchHistory({ type: "undo" });
      expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).preview).toBe(previewOne);

      // Undo back to 0 steps clears preview immediately and makes no preview RPC call.
      actions.dispatchHistory({ type: "undo" });
      expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).preview).toBeNull();
      await vi.advanceTimersByTimeAsync(200);
      expect(previewCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reload(true) replays steps through preview and drops steps that no longer apply", async () => {
    const registry = AtomRegistry.make();
    const threadKey = "env:reload-replay";
    const threadRef: ScopedThreadRef = {
      environmentId: EnvironmentId.make("env"),
      threadId: ThreadId.make("reload-replay"),
    };
    const refreshedLoad: ForkTranscriptLoadResult = { ...loadResult, baseKey: "key-2" };
    const replayedPreview: ForkTranscriptPreviewResult = {
      units: loadResult.units,
      validation: { errors: [], warnings: [] },
      diff: [{ key: "u1", kind: "user", status: "changed", before: "a", after: "keep" }],
      failedAt: null,
    };

    const actions = createForkTranscriptEditActions({
      registry,
      threadKey,
      threadRef,
      debounceMs: 10_000,
      rpc: {
        load: async () => AsyncResult.success(refreshedLoad),
        preview: async (_ref, _baseKey, ops) => {
          const badIndex = ops.findIndex(
            (item) => item.op.kind === "deleteUnit" && item.op.unit === "gone",
          );
          if (badIndex >= 0) {
            return AsyncResult.success({
              units: loadResult.units,
              validation: { errors: [], warnings: [] },
              diff: [],
              failedAt: { index: badIndex, message: "Unit not found." },
            });
          }
          return AsyncResult.success(replayedPreview);
        },
      },
    });

    await actions.ensureLoaded();
    actions.addStep({
      label: "Edit u1",
      unitKeys: ["u1"],
      items: [
        {
          op: { kind: "editUserText", uuid: "u1", block: null, text: "keep" },
          at: "2026-11-25T10:01:00.000Z",
        },
      ],
    });
    actions.addStep({
      label: "Delete gone",
      unitKeys: ["gone"],
      items: [{ op: { kind: "deleteUnit", unit: "gone" }, at: "2026-11-25T10:02:00.000Z" }],
    });

    const dropped = await actions.reload(true);
    expect(dropped.map((step) => step.label)).toEqual(["Delete gone"]);

    const session = registry.get(forkTranscriptEditSessionAtom(threadKey));
    expect(session.load?.baseKey).toBe("key-2");
    expect(session.history.steps.map((step) => step.label)).toEqual(["Edit u1"]);
    expect(session.preview).toBe(replayedPreview);

    // openUnit / closeUnit preserve row id while another unit in the same row stays open.
    actions.openUnit("u1", "shared-row");
    actions.openUnit("a1", "shared-row");
    actions.closeUnit("u1", "shared-row");
    expect([...registry.get(forkTranscriptEditSessionAtom(threadKey)).openRowIds]).toEqual([
      "shared-row",
    ]);
    actions.closeUnit("a1", "shared-row");
    expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).openRowIds.size).toBe(0);

    // discard resets the session back to idle.
    actions.discard();
    expect(registry.get(forkTranscriptEditSessionAtom(threadKey))).toBe(emptyEditSession);
  });

  it("reports the pending changes and the Select mode of the active thread to shortcuts", () => {
    const atom = forkTranscriptEditSessionAtom("env:shortcut-active");
    appAtomRegistry.set(atom, {
      ...emptyEditSession,
      selectMode: true,
      history: {
        steps: [{ id: "s1", label: "Deleted message", unitKeys: ["u1"], items: [] }],
        redo: [],
      },
    });

    retainThreadOverlaysForThread("env:shortcut-other");
    expect(readForkTranscriptShortcutContext()).toEqual({
      forkTranscriptPending: false,
      forkTranscriptSelectMode: false,
    });

    retainThreadOverlaysForThread("env:shortcut-active");
    appAtomRegistry.set(atom, { ...appAtomRegistry.get(atom), selectMode: true });
    expect(readForkTranscriptShortcutContext()).toEqual({
      forkTranscriptPending: true,
      forkTranscriptSelectMode: true,
    });

    appAtomRegistry.set(atom, emptyEditSession);
    retainThreadOverlaysForThread(null);
  });

  it("counts only unlocked units of a row as selectable", () => {
    const session: ForkTranscriptEditSession = {
      ...emptyEditSession,
      status: "ready",
      load: {
        ...loadResult,
        units: [{ ...unit("u1", "user"), locked: true }, unit("a1", "assistant")],
        links: [
          { itemId: "item-u1", unitKey: "u1", inherited: false },
          { itemId: "item-a1", unitKey: "a1", inherited: false },
        ],
      },
      selectMode: true,
      selection: toggleSelect({ keys: new Set(), anchor: null }, "a1"),
    };
    const row = {
      kind: "work",
      id: "row-work",
      createdAt: "2026-11-25T10:00:00.000Z",
      groupedEntries: [
        { projectedItem: { item: { id: "item-u1" } } },
        { projectedItem: { item: { id: "item-a1" } } },
      ],
    } as unknown as MessagesTimelineRow;

    const state = selectRowState(session, row);
    expect(state.unitKeys).toEqual(["u1", "a1"]);
    expect(state.selectableKeys).toEqual(["a1"]);
    expect(state.selected).toBe("all");
  });

  it("toggles the Select mode and loads the transcript when the mode starts", async () => {
    const registry = AtomRegistry.make();
    const threadKey = "env:select-toggle";
    const load = vi.fn(async () => AsyncResult.success(loadResult));
    const actions = createForkTranscriptEditActions({
      registry,
      threadKey,
      threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("t") },
      rpc: {
        load,
        preview: async () =>
          AsyncResult.success({
            units: [],
            validation: { errors: [], warnings: [] },
            diff: [],
            failedAt: null,
          }),
      },
    });

    actions.toggleSelectMode();
    expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).selectMode).toBe(true);
    await vi.waitFor(() =>
      expect(registry.get(forkTranscriptEditSessionAtom(threadKey)).status).toBe("ready"),
    );
    expect(load).toHaveBeenCalledTimes(1);

    actions.setSelection(toggleSelect({ keys: new Set(), anchor: null }, "u1"));
    actions.toggleSelectMode();
    const off = registry.get(forkTranscriptEditSessionAtom(threadKey));
    expect(off.selectMode).toBe(false);
    expect(off.selection.keys.size).toBe(0);
  });
});
