import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  EnvironmentId,
  type ForkTranscriptDiffItem,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPendingOp,
  type ForkTranscriptPreviewResult,
  type ForkTranscriptUnitView,
  MessageId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { Atom } from "effect/reactivity";
import { createRef, useEffect, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { ComposerBannerStack } from "~/components/chat/ComposerBannerStack";
import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { retainThreadOverlaysForThread } from "~/components/chat/threadOverlayRetention";
import { resolveShortcutCommand } from "~/keybindings";
import { isEditableFocused } from "~/lib/editableFocus";
import { AppAtomRegistryProvider, appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";
import { act, render } from "../../../test/render";
import { emptyEditSession, forkTranscriptEditSessionAtom } from "./editSession";
import { useForkTranscriptBannerItems } from "./forkTranscriptBannerItems";
import { useForkTranscriptCommands } from "./transcriptEditCommands";

const rpc = vi.hoisted(() => ({
  load: vi.fn<(input: unknown) => unknown>(),
  preview: vi.fn<(input: unknown) => unknown>(),
}));

vi.mock(import("./transcriptEditRpc"), async () => {
  const Effect = await import("effect/Effect");
  const command = (label: string, run: (input: unknown) => unknown) => ({
    label,
    run: (_registry: unknown, args: { readonly input: unknown }) =>
      Effect.promise(async () => run(args.input)),
  });
  return {
    forkTranscriptLoad: command("load", (input) => rpc.load(input)),
    forkTranscriptPreview: command("preview", (input) => rpc.preview(input)),
    forkTranscriptBlockText: command("blockText", () => null),
    forkTranscriptSave: command("save", () => null),
    forkTranscriptBackups: command("backups", () => []),
    forkTranscriptRestore: command("restore", () => null),
    forkTranscriptDeleteBackup: command("deleteBackup", () => undefined),
  } as never;
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-11-25T10:02:00.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const unit = (
  key: string,
  kind: ForkTranscriptUnitView["kind"],
  text: string,
  thinking = false,
): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: CREATED_AT,
  blocks:
    kind === "tool"
      ? []
      : [
          ...(thinking
            ? [
                {
                  uuid: `${key}-thinking`,
                  index: 0,
                  type: "thinking" as const,
                  text: "thought",
                  truncated: false,
                  editable: false,
                  removable: true,
                },
              ]
            : []),
          {
            uuid: key,
            index: kind === "user" ? null : 0,
            type: "text" as const,
            text,
            truncated: false,
            editable: true,
            removable: false,
          },
        ],
  entries: [],
  hidden: [],
  excerpt: text,
});

const BASE_UNITS = [
  unit("u1", "user", "Fix the parser"),
  unit("a1", "assistant", "reply one", true),
  unit("t1", "tool", "vp test run"),
  unit("a2", "assistant", "reply two"),
  unit("a3", "assistant", "reply three"),
  unit("a4", "assistant", "reply four"),
];

const loadResult: ForkTranscriptLoadResult = {
  sessionId: "session-1",
  baseKey: "key-1",
  units: BASE_UNITS,
  links: BASE_UNITS.map((item) => ({
    itemId: `item-${item.key}`,
    unitKey: item.key,
    inherited: false,
  })),
  compactionItemId: null,
  validation: { errors: [], warnings: [] },
  live: { editable: true, reason: null, working: false },
};

// Applies delete and move ops the way the server core does, enough for the timeline looks.
const previewFor = (
  input: unknown,
  base: ReadonlyArray<ForkTranscriptUnitView> = BASE_UNITS,
): ForkTranscriptPreviewResult => {
  const ops = (input as { readonly ops: ReadonlyArray<ForkTranscriptPendingOp> }).ops;
  const applied = ops.reduce<ReadonlyArray<ForkTranscriptUnitView>>((units, { op }) => {
    if (op.kind === "deleteUnits") return units.filter((item) => !op.units.includes(item.key));
    if (op.kind !== "moveUnit") return units;
    const moved = units.find((item) => item.key === op.unit)!;
    const rest = units.filter((item) => item.key !== op.unit);
    return [...rest.slice(0, op.toIndex), moved, ...rest.slice(op.toIndex)];
  }, base);
  const keys = applied.map((item) => item.key);
  const baseRest = base.map((item) => item.key).filter((key) => keys.includes(key));
  const diff: ReadonlyArray<ForkTranscriptDiffItem> = [
    ...base
      .filter((item) => !keys.includes(item.key))
      .map((item) => ({
        key: item.key,
        kind: item.kind,
        status: "removed" as const,
        before: item.excerpt,
        after: null,
      })),
    ...keys.flatMap((key, index) =>
      baseRest[index] === key
        ? []
        : [{ key, kind: "assistant" as const, status: "moved" as const, before: key, after: key }],
    ),
  ];
  return { units: applied, validation: { errors: [], warnings: [] }, diff, failedAt: null };
};

const sourceThread = { id: "thread-1" };

const v2Item = (type: string, id: string) =>
  ({
    position: 0,
    visibility: "local",
    sourceThreadId: sourceThread.id,
    sourceItemId: id,
    item: {
      id,
      threadId: sourceThread.id,
      runId: null,
      nodeId: null,
      providerThreadId: "provider-thread-1",
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: {},
      type,
    },
  }) as never;

const messageEntry = (key: string, role: "user" | "assistant", text: string): Entry => ({
  id: `entry-${key}`,
  kind: "message",
  createdAt: CREATED_AT,
  message: {
    id: MessageId.make(`message-${key}`),
    role,
    text,
    runId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    streaming: false,
  },
  projectedItem: v2Item(role === "user" ? "user_message" : "assistant_message", `item-${key}`),
});

const makeEntries = (): ReadonlyArray<Entry> => [
  messageEntry("u1", "user", "Fix the parser"),
  messageEntry("a1", "assistant", "reply one"),
  {
    id: "entry-t1",
    kind: "work",
    createdAt: CREATED_AT,
    entry: {
      id: "entry-t1",
      createdAt: CREATED_AT,
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      command: "vp test run",
      projectedItem: v2Item("command_execution", "item-t1"),
    },
  } as Entry,
  messageEntry("a2", "assistant", "reply two"),
  messageEntry("a3", "assistant", "reply three"),
  messageEntry("a4", "assistant", "reply four"),
];

const mockThread = () => {
  sourceThread.id = `thread-${Math.random().toString(36).slice(2)}`;
  return vi.spyOn(environmentThreadDetails, "threadAtom").mockReturnValue(
    Atom.make({
      projection: {
        thread: { activeProviderThreadId: "provider-thread-1" },
        turnItems: [],
        visibleTurnItems: [],
        runs: [],
        attempts: [],
        nodes: [],
        subagents: [],
        providerSessions: [],
        providerThreads: [
          { id: "provider-thread-1", driver: "claudeAgent", providerSessionId: null },
        ],
        providerTurns: [],
        runtimeRequests: [],
        checkpoints: [],
        contextHandoffs: [],
        contextTransfers: [],
      },
    }) as never,
  );
};

// Stands in for useChatShortcuts: resolve the chord, then run the command map entry.
function KeyBridge(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly threadUndo: () => void;
}) {
  const commands = useForkTranscriptCommands(props.threadKey, props.threadRef);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
        platform: "Win32",
        context: { editableFocus: isEditableFocused(event.target) },
      });
      const run =
        command === "thread.undo"
          ? () => props.threadUndo()
          : command === null
            ? undefined
            : (
                commands as Record<
                  string,
                  ((input: { event: KeyboardEvent }) => unknown) | undefined
                >
              )[command];
      if (run === undefined || run({ event }) === false) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands, props]);
  return null;
}

function Bar(props: { readonly threadKey: string; readonly threadRef: ScopedThreadRef }) {
  const items = useForkTranscriptBannerItems(
    props.threadKey,
    props.threadRef,
    createRef<LegendListRef | null>(),
  );
  return <ComposerBannerStack items={items} detached />;
}

const renderSelect = async () => {
  const container = document.createElement("div");
  container.style.cssText = "height: 1400px; width: 900px; display: flex; flex-direction: column;";
  const threadId = `thread-${Math.random().toString(36).slice(2)}`;
  const threadKey = `environment-local:${threadId}`;
  const threadRef: ScopedThreadRef = {
    environmentId: ENVIRONMENT_ID,
    threadId: ThreadId.make(threadId),
  };
  const threadUndo = vi.fn();
  retainThreadOverlaysForThread(threadKey);
  const screen = await render(
    <AppAtomRegistryProvider>
      <KeyBridge threadKey={threadKey} threadRef={threadRef} threadUndo={threadUndo} />
      <div style={{ height: 1100, display: "flex", flexDirection: "column" }}>
        <MessagesTimeline
          isWorking={false}
          listRef={createRef<LegendListRef | null>()}
          latestRun={null}
          turnDiffSummaries={[]}
          runs={[]}
          routeThreadKey={threadKey}
          onOpenThread={() => {}}
          onForkFromRun={async () => {}}
          supportsConversationRollback={false}
          onRevertToTurnCount={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          activeThreadEnvironmentId={ENVIRONMENT_ID}
          markdownCwd={undefined}
          resolvedTheme="light"
          timestampFormat="locale"
          workspaceRoot={undefined}
          anchorMessageId={null}
          onAnchorReady={() => {}}
          onAnchorSizeChanged={() => {}}
          contentInsetEndAdjustment={0}
          emptyPlaceholderInset={0}
          liveFollowEnabled
          onIsAtEndChange={() => {}}
          canOperateThread
          timelineEntries={makeEntries() as Entry[]}
        />
      </div>
      <Bar threadKey={threadKey} threadRef={threadRef} />
    </AppAtomRegistryProvider>,
    { container },
  );
  const fold = () =>
    container.querySelector<HTMLElement>('[data-timeline-row-kind="turn-fold"] button');
  await expect.poll(fold).not.toBeNull();
  await act(async () => fold()!.click());
  await expect
    .poll(() => container.querySelector('[data-timeline-row-id="entry-a1"]'))
    .not.toBeNull();
  return Object.assign(screen, { threadKey, threadUndo });
};

const session = (threadKey: string) =>
  appAtomRegistry.get(forkTranscriptEditSessionAtom(threadKey));

const selectable = (container: HTMLElement, unitKey: string) => {
  const item = [
    ...container.querySelectorAll<HTMLElement>("[data-fork-transcript-select-keys]"),
  ].find((element) => element.dataset.forkTranscriptSelectKeys?.split(" ").includes(unitKey));
  if (item === undefined) throw new Error(`Missing selectable ${unitKey}`);
  return item;
};

const checkboxOf = (container: HTMLElement, unitKey: string) =>
  selectable(container, unitKey).querySelector<HTMLElement>(
    "[data-fork-transcript-select-checkbox]",
  )!;

const barButton = (name: string) => {
  const bar = document.querySelector<HTMLElement>("[data-fork-transcript-select-bar]");
  const match = [...(bar?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name,
  );
  if (match === undefined) throw new Error(`Missing bar button ${name}`);
  return match;
};

const startSelectMode = async (screen: Awaited<ReturnType<typeof renderSelect>>) => {
  await userEvent.keyboard("{Control>}{Alt>}s{/Alt}{/Control}");
  await expect.poll(() => session(screen.threadKey).selectMode).toBe(true);
  await expect.poll(() => session(screen.threadKey).status).toBe("ready");
  await expect
    .poll(() => screen.container.querySelectorAll("[data-fork-transcript-select-checkbox]").length)
    .toBeGreaterThan(0);
};

const pointer = (type: string, target: EventTarget, at: { x: number; y: number }) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );

const centerOf = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

describe("ForkTranscriptSelect", () => {
  const ready = (load: ForkTranscriptLoadResult = loadResult) => {
    rpc.load.mockReset();
    rpc.preview.mockReset();
    rpc.load.mockReturnValue(load);
    rpc.preview.mockImplementation((input) => previewFor(input, load.units));
    appAtomRegistry.set(forkTranscriptEditSessionAtom("unused"), emptyEditSession);
  };

  it("shows checkboxes with Ctrl+Alt+S and ends the mode with Done", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();

    await startSelectMode(screen);
    expect(rpc.load).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-fork-transcript-select-count]")?.textContent).toBe(
      "None selected",
    );
    expect(barButton("Delete").disabled).toBe(true);

    await act(async () => barButton("Done").click());
    expect(session(screen.threadKey).selectMode).toBe(false);
    expect(screen.container.querySelector("[data-fork-transcript-select-checkbox]")).toBeNull();
  });

  it("selects a range with Shift+click and deletes it in one step that one Undo reverts", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "u1"));
    await userEvent.click(checkboxOf(screen.container, "a2"), { modifiers: ["Shift"] });
    expect([...session(screen.threadKey).selection.keys].toSorted()).toEqual([
      "a1",
      "a2",
      "t1",
      "u1",
    ]);
    expect(selectable(screen.container, "a1").dataset.selected).toBe("true");
    expect(document.querySelector("[data-fork-transcript-select-count]")?.textContent).toBe(
      "4 of 6 selected",
    );

    await act(async () => barButton("Delete").click());
    expect(session(screen.threadKey).history.steps.map((item) => item.label)).toEqual([
      "Deleted 4 messages",
    ]);
    await expect
      .poll(() => screen.container.querySelectorAll("[data-fork-transcript-removed]").length)
      .toBe(4);
    await expect.poll(() => session(screen.threadKey).selection.keys.size).toBe(0);

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(screen.threadUndo).not.toHaveBeenCalled();
    expect(session(screen.threadKey).history.steps).toHaveLength(0);
    await expect
      .poll(() => screen.container.querySelectorAll("[data-fork-transcript-removed]").length)
      .toBe(0);

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(screen.threadUndo).toHaveBeenCalledTimes(1);
  });

  it("toggles a row with a click on its body and moves the selection down", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    const body = selectable(screen.container, "a3").querySelector<HTMLElement>(
      "[data-fork-transcript-select-content]",
    )!;
    await userEvent.click(body);
    expect([...session(screen.threadKey).selection.keys]).toEqual(["a3"]);

    await act(async () => barButton("Move down").click());
    expect(session(screen.threadKey).history.steps.map((item) => item.label)).toEqual([
      "Moved message",
    ]);
    expect(session(screen.threadKey).history.steps[0]?.items.map((item) => item.op)).toEqual([
      { kind: "moveUnit", unit: "a3", toIndex: 5 },
    ]);
    expect([...session(screen.threadKey).selection.keys]).toEqual(["a3"]);
  });

  it("enables Remove thinking only for a selection with thinking", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "a2"));
    expect(barButton("Remove thinking").disabled).toBe(true);
    await userEvent.click(checkboxOf(screen.container, "a1"));
    expect(barButton("Remove thinking").disabled).toBe(false);

    await act(async () => barButton("Remove thinking").click());
    expect(session(screen.threadKey).history.steps[0]?.items.map((item) => item.op)).toEqual([
      { kind: "removeThinking", target: { uuid: "a1-thinking", block: 0 } },
    ]);
  });

  it("opens the insert composer after the one selected unit", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "a2"));
    await userEvent.click(checkboxOf(screen.container, "a3"));
    expect(barButton("Insert below").disabled).toBe(true);
    await userEvent.click(checkboxOf(screen.container, "a3"));
    expect(barButton("Insert below").disabled).toBe(false);

    await act(async () => barButton("Insert below").click());
    const lane = screen.container
      .querySelector('[data-timeline-row-id="entry-a2"]')!
      .closest<HTMLElement>("[data-timeline-root]")!;
    await expect
      .poll(() => lane.querySelector('[data-fork-transcript-insert-composer="below"]'))
      .not.toBeNull();
  });

  it("clears the selection on the first Escape and ends the mode on the second", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "a2"));
    await act(async () => barButton("Delete").click());
    expect(session(screen.threadKey).selection.keys.size).toBe(0);
    await userEvent.click(checkboxOf(screen.container, "a3"));
    expect(session(screen.threadKey).selection.keys.size).toBe(1);

    await userEvent.keyboard("{Escape}");
    expect(session(screen.threadKey).selection.keys.size).toBe(0);
    expect(session(screen.threadKey).selectMode).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(session(screen.threadKey).selectMode).toBe(false);
    expect(session(screen.threadKey).history.steps).toHaveLength(1);
  });

  it("selects all and extends the selection with keys while focus is in the timeline", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "a2"));
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect([...session(screen.threadKey).selection.keys].toSorted()).toEqual(["a2", "a3"]);
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(session(screen.threadKey).history.steps.map((item) => item.label)).toEqual([
      "Moved 2 messages",
    ]);
    // A moved row can render again and drop its focus to the body.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("{Control>}a{/Control}");
    expect(session(screen.threadKey).selection.keys.size).toBe(BASE_UNITS.length);
  });

  it("selects the rows under a drag that starts on a checkbox", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    const start = checkboxOf(screen.container, "a1");
    const end = checkboxOf(screen.container, "a3");
    await act(async () => {
      pointer("pointerdown", start, centerOf(start));
      pointer("pointermove", document, centerOf(selectable(screen.container, "a2")));
      pointer("pointermove", document, centerOf(end));
      pointer("pointerup", document, centerOf(end));
      end.click();
    });
    expect([...session(screen.threadKey).selection.keys].toSorted()).toEqual([
      "a1",
      "a2",
      "a3",
      "t1",
    ]);
  });

  it("moves the selection with a drag on its grip and adds one pending step", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "u1"));
    const grip = selectable(screen.container, "u1").querySelector<HTMLElement>(
      "[data-fork-transcript-drag-handle]",
    )!;
    const target = selectable(screen.container, "a3");
    const from = centerOf(grip);
    const rect = target.getBoundingClientRect();
    const to = { x: rect.left + 40, y: rect.bottom - 4 };
    await act(async () => {
      pointer("pointerdown", grip, from);
      pointer("pointermove", document, { x: from.x, y: from.y + 10 });
    });
    await expect.poll(() => document.body.textContent?.includes("Moving 1 message")).toBe(true);
    await act(async () => pointer("pointermove", document, to));
    await expect
      .poll(() =>
        target.querySelector("[data-fork-transcript-drop-line]")?.getAttribute("data-side"),
      )
      .toBe("after");
    await act(async () => pointer("pointerup", document, to));

    expect(session(screen.threadKey).history.steps.map((item) => item.label)).toEqual([
      "Moved message",
    ]);
    expect(session(screen.threadKey).history.steps[0]?.items.map((item) => item.op)).toEqual([
      { kind: "moveUnit", unit: "u1", toIndex: 4 },
    ]);
    // dnd-kit blocks clicks for a short time after a drop, so the test waits until a click lands.
    const probe = document.createElement("button");
    const landed = vi.fn();
    probe.addEventListener("click", landed);
    document.body.append(probe);
    await vi.waitFor(() => {
      probe.click();
      expect(landed).toHaveBeenCalled();
    });
    probe.remove();
  });

  it("builds each step from the pending order while the preview is still out", async () => {
    ready();
    const gate = Promise.withResolvers<void>();
    rpc.preview.mockImplementation(async (input) => {
      await gate.promise;
      return previewFor(input);
    });
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await userEvent.click(checkboxOf(screen.container, "a3"));
    await userEvent.click(checkboxOf(screen.container, "a4"), { modifiers: ["Shift"] });
    await userEvent.keyboard("{Delete}");
    await userEvent.click(checkboxOf(screen.container, "a2"));
    // a2 is the last unit after the delete, so Move down has nothing to do.
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(session(screen.threadKey).history.steps.map((item) => item.label)).toEqual([
      "Deleted 2 messages",
    ]);
    expect(barButton("Move up").disabled).toBe(false);
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}{Alt>}{ArrowUp}{/Alt}");
    expect(
      session(screen.threadKey)
        .history.steps.slice(1)
        .flatMap((item) => item.items.map((pending) => pending.op)),
    ).toEqual([
      { kind: "moveUnit", unit: "a2", toIndex: 2 },
      { kind: "moveUnit", unit: "a2", toIndex: 1 },
    ]);

    gate.resolve();
    await expect
      .poll(() => session(screen.threadKey).preview?.units.map((item) => item.key))
      .toEqual(["u1", "a2", "a1", "t1"]);
    expect(barButton("Delete").disabled).toBe(false);
  });

  it("keeps every option working after Done and a second start", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();

    const round = async (expectedSteps: number) => {
      await startSelectMode(screen);
      await userEvent.click(checkboxOf(screen.container, "a2"));
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      expect([...session(screen.threadKey).selection.keys].toSorted()).toEqual(["a2", "a3"]);
      await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
      await act(async () => barButton("Move down").click());
      await userEvent.keyboard("{Control>}a{/Control}");
      expect(session(screen.threadKey).selection.keys.size).toBe(BASE_UNITS.length);
      await userEvent.keyboard("{Escape}");
      expect(session(screen.threadKey).selection.keys.size).toBe(0);
      expect(session(screen.threadKey).history.steps).toHaveLength(expectedSteps);
      await act(async () => barButton("Done").click());
      expect(session(screen.threadKey).selectMode).toBe(false);
    };
    await round(2);
    await round(4);
    await userEvent.keyboard("{Control>}z{/Control}{Control>}z{/Control}");
    await round(4);
  });

  it("extends the selection with Shift+click on a row body", async () => {
    ready();
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    const body = (key: string) =>
      selectable(screen.container, key).querySelector<HTMLElement>(
        "[data-fork-transcript-select-content]",
      )!;
    await userEvent.click(body("a2"));
    await userEvent.click(body("a4"), { modifiers: ["Shift"] });
    expect([...session(screen.threadKey).selection.keys].toSorted()).toEqual(["a2", "a3", "a4"]);
    expect(window.getSelection()?.toString() ?? "").toBe("");
  });

  it("deletes a file-only entry from its draft row and restores it from the Removed line", async () => {
    const units = [
      ...BASE_UNITS.slice(0, 4),
      unit("sys1", "system", "compact boundary"),
      ...BASE_UNITS.slice(4),
    ];
    ready({ ...loadResult, units });
    using _thread = mockThread();
    await using screen = await renderSelect();
    await startSelectMode(screen);

    await expect
      .poll(() => screen.container.querySelector('[data-fork-transcript-draft="sys1"]'))
      .not.toBeNull();
    await userEvent.click(checkboxOf(screen.container, "sys1"));
    await act(async () => barButton("Delete").click());
    expect(session(screen.threadKey).history.steps.map((item) => item.label)).toEqual([
      "Deleted message",
    ]);

    const removed = () =>
      screen.container.querySelector<HTMLElement>('[data-fork-transcript-removed="sys1"]');
    await expect.poll(removed).not.toBeNull();
    expect(removed()?.textContent).toContain("Not shown in the timeline: system entry");
    const restore = [...removed()!.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore",
    )!;
    await act(async () => restore.click());
    expect(session(screen.threadKey).history.steps).toHaveLength(0);
  });
});
