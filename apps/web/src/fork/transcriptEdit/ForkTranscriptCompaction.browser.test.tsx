import {
  EnvironmentId,
  type ForkTranscriptLoadResult,
  type ForkTranscriptUnitView,
  MessageId,
} from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { Atom } from "effect/reactivity";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { toastManager } from "~/components/ui/toast";
import { AppAtomRegistryProvider, appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";
import { act, render } from "../../../test/render";
import { forkTranscriptEditSessionAtom } from "./editSession";

const rpc = vi.hoisted(() => ({ load: vi.fn<(input: unknown) => unknown>() }));

vi.mock(import("./transcriptEditRpc"), async () => {
  const Effect = await import("effect/Effect");
  const command = (label: string, run: (input: unknown) => unknown) => ({
    label,
    run: (_registry: unknown, args: { readonly input: unknown }) =>
      Effect.sync(() => run(args.input)),
  });
  return {
    forkTranscriptLoad: command("load", (input) => rpc.load(input)),
    forkTranscriptPreview: command("preview", () => null),
    forkTranscriptBlockText: command("blockText", () => ""),
    forkTranscriptSave: command("save", () => null),
    forkTranscriptBackups: command("backups", () => []),
    forkTranscriptRestore: command("restore", () => null),
    forkTranscriptDeleteBackup: command("deleteBackup", () => undefined),
  } as never;
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-11-25T10:02:00.000Z";
const BEFORE_TOOLTIP =
  "Claude sees only the compaction summary for this part, so these messages cannot be edited.";
const EARLIER_TOOLTIP =
  "This message is in an earlier Claude session. Only the current session file can be edited.";
const HANDOFF_TOOLTIP =
  "This message holds the summary of the earlier Claude sessions that T3 sent after a recovery. It is locked, because Claude needs it.";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const unit = (key: string, kind: ForkTranscriptUnitView["kind"]): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: CREATED_AT,
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: key,
});

const loadResult = (
  compactionItemId: string | null,
  extra: Partial<ForkTranscriptLoadResult> = {},
): ForkTranscriptLoadResult => ({
  sessionId: "session-1",
  baseKey: "key-1",
  units: [unit("u1", "user"), unit("a1", "assistant")],
  links: [
    { itemId: "item-u1", unitKey: "u1", inherited: false },
    { itemId: "item-a1", unitKey: "a1", inherited: false },
  ],
  compactionItemId,
  validation: { errors: [], warnings: [] },
  live: { editable: true, reason: null, working: false },
  ...extra,
});

const sourceThread = { id: "thread-1" };

const v2Item = (type: string, id: string, position: number, extra: object = {}) =>
  ({
    position,
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
      ordinal: position,
      status: "completed",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: {},
      type,
      ...extra,
    },
  }) as never;

const MESSAGES = [
  { key: "u0", role: "user", text: "Old question", position: 0 },
  { key: "u1", role: "user", text: "New question", position: 2 },
  { key: "a1", role: "assistant", text: "New reply", position: 3 },
  { key: "u2", role: "user", text: "Unlinked question", position: 4 },
] as const;

const itemOf = (message: (typeof MESSAGES)[number]) =>
  v2Item(`${message.role}_message`, `item-${message.key}`, message.position);

const makeEntries = (): ReadonlyArray<Entry> =>
  MESSAGES.map((message) => ({
    id: `entry-${message.key}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(`message-${message.key}`),
      role: message.role,
      text: message.text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
    },
    projectedItem: itemOf(message),
  }));

type ThreadShape = { readonly compaction: boolean; readonly spans: boolean };

// Without a compaction, u0 belongs to provider turn 1, which a replaced session holds.
const quietRows = (shape: ThreadShape) => [
  ...MESSAGES.map((message) =>
    message.key === "u0" && !shape.compaction
      ? v2Item("user_message", "item-u0", 0, { providerTurnId: "provider-turn-1" })
      : itemOf(message),
  ),
  ...(shape.compaction ? [v2Item("compaction", "item-c1", 1, { driver: "claudeAgent" })] : []),
];

// Item support atoms are cached per source thread, so each test uses a fresh one.
const mockThread = (shape: ThreadShape = { compaction: true, spans: false }) => {
  sourceThread.id = `thread-${Math.random().toString(36).slice(2)}`;
  const rows = quietRows(shape);
  const quiet = vi
    .spyOn(environmentThreadDetails, "quietVisibleTurnItemsAtom")
    .mockReturnValue(Atom.make(rows) as never);
  const thread = vi.spyOn(environmentThreadDetails, "threadAtom").mockReturnValue(
    Atom.make({
      projection: {
        thread: { activeProviderThreadId: "provider-thread-1" },
        turnItems: rows.map((row) => (row as { item: object }).item),
        visibleTurnItems: [],
        runs: [],
        attempts: [],
        nodes: [],
        subagents: [],
        providerSessions: [],
        providerThreads: [
          {
            id: "provider-thread-1",
            driver: "claudeAgent",
            providerSessionId: null,
            nativeMetadata: shape.spans
              ? {
                  forkClaudeSessions: [
                    { sessionId: "session-0", firstTurnOrdinal: 1, lastTurnOrdinal: 1 },
                  ],
                }
              : null,
          },
        ],
        providerTurns: [
          { id: "provider-turn-1", providerThreadId: "provider-thread-1", ordinal: 1 },
          { id: "provider-turn-2", providerThreadId: "provider-thread-1", ordinal: 2 },
        ],
        runtimeRequests: [],
        checkpoints: [],
        contextHandoffs: [],
        contextTransfers: [],
      },
    }) as never,
  );
  return {
    [Symbol.dispose]: () => {
      quiet.mockRestore();
      thread.mockRestore();
    },
  };
};

const renderTimeline = async () => {
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 900px; display: flex; flex-direction: column;";
  const threadKey = `environment-local:thread-${Math.random().toString(36).slice(2)}`;
  const screen = await render(
    <AppAtomRegistryProvider>
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
    </AppAtomRegistryProvider>,
    { container },
  );
  return Object.assign(screen, { threadKey });
};

const row = (container: HTMLElement, key: string) => {
  const element = container.querySelector<HTMLElement>(`[data-timeline-row-id="entry-${key}"]`);
  if (element === null) throw new Error(`Missing row ${key}`);
  return element;
};

const editButtonOf = (container: HTMLElement, key: string) =>
  row(container, key).querySelector<HTMLButtonElement>('button[aria-label="Edit"]');

const earlierMarkerOf = (container: HTMLElement, key: string) =>
  row(container, key).querySelector<HTMLElement>('[data-fork-transcript-cut="earlier-session"]');

const markerOf = (container: HTMLElement, key: string) =>
  row(container, key).querySelector<HTMLElement>('[data-fork-transcript-cut="before-compaction"]');

const clickEdit = async (container: HTMLElement, key: string) => {
  await userEvent.hover(row(container, key));
  const button = editButtonOf(container, key);
  if (button === null) throw new Error(`Missing Edit button on ${key}`);
  await act(async () => button.click());
};

const loadedSession = (threadKey: string) =>
  appAtomRegistry.get(forkTranscriptEditSessionAtom(threadKey));

describe("Fork transcript compaction marker", () => {
  it("marks a row before the last compaction before the first load", async () => {
    rpc.load.mockReset();
    using _thread = mockThread();
    await using screen = await renderTimeline();
    const container = screen.container;
    await expect.poll(() => markerOf(container, "u0")?.textContent).toBe("Before compaction");
    expect(editButtonOf(container, "u0")).toBeNull();
    expect(["u1", "a1", "u2"].map((key) => editButtonOf(container, key)?.disabled)).toEqual([
      false,
      false,
      false,
    ]);
    expect(rpc.load).not.toHaveBeenCalled();
    await userEvent.hover(markerOf(container, "u0")!);
    await expect.poll(() => document.body.textContent).toContain(BEFORE_TOOLTIP);
  });

  it("shows a toast with the reason when Edit finds no link, and keeps the marker", async () => {
    rpc.load.mockReset();
    rpc.load.mockReturnValue(loadResult("item-c1"));
    const toast = vi.spyOn(toastManager, "add");
    using _thread = mockThread();
    await using screen = await renderTimeline();
    await expect.poll(() => editButtonOf(screen.container, "u2")).not.toBeNull();
    await clickEdit(screen.container, "u2");
    await expect.poll(() => toast.mock.calls.length).toBe(1);
    expect(toast.mock.calls[0]?.[0]).toMatchObject({
      type: "info",
      title: "This entry cannot be edited",
      description:
        "This entry is not in the session file that was loaded. Save or discard the changes, then try again.",
    });
    expect(markerOf(screen.container, "u0")).not.toBeNull();
    expect(editButtonOf(screen.container, "u2")?.disabled).toBe(true);
    toast.mockRestore();
  });

  it("drops the marker when the server finds no compaction on the active path", async () => {
    rpc.load.mockReset();
    rpc.load.mockReturnValue(loadResult(null));
    using _thread = mockThread();
    await using screen = await renderTimeline();
    await expect.poll(() => markerOf(screen.container, "u0")).not.toBeNull();
    await clickEdit(screen.container, "a1");
    await expect.poll(() => loadedSession(screen.threadKey).load).not.toBeNull();
    await expect.poll(() => markerOf(screen.container, "u0")).toBeNull();
    expect(editButtonOf(screen.container, "u0")?.disabled).toBe(true);
  });

  it("gives no checkbox to a row before the compaction in Select mode", async () => {
    rpc.load.mockReset();
    rpc.load.mockReturnValue(loadResult("item-c1"));
    using _thread = mockThread();
    await using screen = await renderTimeline();
    await expect.poll(() => editButtonOf(screen.container, "u2")).not.toBeNull();
    await clickEdit(screen.container, "u2");
    await expect.poll(() => loadedSession(screen.threadKey).load).not.toBeNull();
    const atom = forkTranscriptEditSessionAtom(screen.threadKey);
    await act(async () =>
      appAtomRegistry.set(atom, { ...appAtomRegistry.get(atom), selectMode: true }),
    );
    const selectables = () => [
      ...screen.container.querySelectorAll<HTMLElement>("[data-fork-transcript-select-keys]"),
    ];
    await expect
      .poll(() => selectables().map((element) => element.dataset.forkTranscriptSelectKeys))
      .toEqual(["u1", "a1"]);
    expect(selectables().some((element) => element.textContent?.includes("Old question"))).toBe(
      false,
    );
  });
});

describe("Fork transcript earlier-session marker", () => {
  const EARLIER = { compaction: false, spans: true };
  const UNRECORDED = { compaction: false, spans: false };

  it("marks a row of a recorded earlier Claude session before the first load", async () => {
    rpc.load.mockReset();
    using _thread = mockThread(EARLIER);
    await using screen = await renderTimeline();
    const container = screen.container;
    await expect.poll(() => earlierMarkerOf(container, "u0")?.textContent).toBe("Earlier session");
    expect(editButtonOf(container, "u0")).toBeNull();
    expect(["u1", "a1", "u2"].map((key) => editButtonOf(container, key)?.disabled)).toEqual([
      false,
      false,
      false,
    ]);
    expect(rpc.load).not.toHaveBeenCalled();
    await userEvent.hover(earlierMarkerOf(container, "u0")!);
    await expect.poll(() => document.body.textContent).toContain(EARLIER_TOOLTIP);
  });

  it("marks the row from the server item after the load and explains it in a toast", async () => {
    rpc.load.mockReset();
    rpc.load.mockReturnValue(loadResult(null, { earlierSessionItemId: "item-u0" }));
    const toast = vi.spyOn(toastManager, "add");
    using _thread = mockThread(UNRECORDED);
    await using screen = await renderTimeline();
    await expect.poll(() => editButtonOf(screen.container, "u0")).not.toBeNull();
    expect(earlierMarkerOf(screen.container, "u0")).toBeNull();
    await clickEdit(screen.container, "u0");
    await expect.poll(() => toast.mock.calls.length).toBe(1);
    expect(toast.mock.calls[0]?.[0]).toMatchObject({
      type: "info",
      title: "This entry cannot be edited",
      description: EARLIER_TOOLTIP,
    });
    await expect.poll(() => earlierMarkerOf(screen.container, "u0")).not.toBeNull();
    toast.mockRestore();
  });

  it("gives no checkbox to a row of an earlier session in Select mode", async () => {
    rpc.load.mockReset();
    rpc.load.mockReturnValue(loadResult(null, { earlierSessionItemId: "item-u0" }));
    using _thread = mockThread(EARLIER);
    await using screen = await renderTimeline();
    await expect.poll(() => editButtonOf(screen.container, "a1")).not.toBeNull();
    await clickEdit(screen.container, "a1");
    await expect.poll(() => loadedSession(screen.threadKey).load).not.toBeNull();
    const atom = forkTranscriptEditSessionAtom(screen.threadKey);
    await act(async () =>
      appAtomRegistry.set(atom, { ...appAtomRegistry.get(atom), selectMode: true }),
    );
    const selectables = () => [
      ...screen.container.querySelectorAll<HTMLElement>("[data-fork-transcript-select-keys]"),
    ];
    await expect
      .poll(() => selectables().map((element) => element.dataset.forkTranscriptSelectKeys))
      .toEqual(["u1", "a1"]);
    expect(earlierMarkerOf(screen.container, "u0")).not.toBeNull();
  });

  it("explains the locked recovery handoff prompt", async () => {
    rpc.load.mockReset();
    rpc.load.mockReturnValue(
      loadResult(null, {
        units: [{ ...unit("u1", "user"), locked: true, handoff: true }, unit("a1", "assistant")],
      }),
    );
    const toast = vi.spyOn(toastManager, "add");
    using _thread = mockThread(UNRECORDED);
    await using screen = await renderTimeline();
    await expect.poll(() => editButtonOf(screen.container, "u1")).not.toBeNull();
    await clickEdit(screen.container, "u1");
    await expect.poll(() => toast.mock.calls.length).toBe(1);
    expect(toast.mock.calls[0]?.[0]).toMatchObject({ description: HANDOFF_TOOLTIP });
    await expect.poll(() => editButtonOf(screen.container, "u1")?.disabled).toBe(true);
    toast.mockRestore();
  });
});
