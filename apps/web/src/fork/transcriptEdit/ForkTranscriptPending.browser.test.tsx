import {
  EnvironmentId,
  type ForkTranscriptDiffItem,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPreviewInput,
  type ForkTranscriptPreviewResult,
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
import { AppAtomRegistryProvider, appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";
import { act, render } from "../../../test/render";
import { emptyEditSession, forkTranscriptEditSessionAtom } from "./editSession";
import type { Step } from "./history.logic";

const rpc = vi.hoisted(() => ({
  load: vi.fn<(input: unknown) => unknown>(),
  preview: vi.fn<(input: unknown) => unknown>(),
}));

vi.mock(import("./transcriptEditRpc"), async () => {
  const Effect = await import("effect/Effect");
  const command = (label: string, run: (input: unknown) => unknown) => ({
    label,
    run: (_registry: unknown, args: { readonly input: unknown }) =>
      Effect.sync(() => run(args.input)),
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
const AT = "2026-11-25T10:05:00.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

const unit = (
  key: string,
  kind: ForkTranscriptUnitView["kind"],
  text: string,
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
          {
            uuid: key,
            index: kind === "user" ? null : 0,
            type: kind === "system" ? "system" : "text",
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

const UNITS = {
  u1: unit("u1", "user", "Fix the parser"),
  a1: unit("a1", "assistant", "reply one"),
  t1: unit("t1", "tool", "vp test run"),
  a2: unit("a2", "assistant", "reply two"),
  a3: unit("a3", "assistant", "reply three"),
  a4: unit("a4", "assistant", "reply four"),
};
const BASE_UNITS = Object.values(UNITS);

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

const mockThread = (driver: string) => {
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
        providerThreads: [{ id: "provider-thread-1", driver, providerSessionId: null }],
        providerTurns: [],
        runtimeRequests: [],
        checkpoints: [],
        contextHandoffs: [],
        contextTransfers: [],
      },
    }) as never,
  );
};

const renderTimeline = async () => {
  const container = document.createElement("div");
  container.style.cssText = "height: 1400px; width: 900px; display: flex; flex-direction: column;";
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
  // A finished turn folds its middle rows, so the helper expands it.
  const fold = () =>
    container.querySelector<HTMLElement>('[data-timeline-row-kind="turn-fold"] button');
  await expect.poll(fold).not.toBeNull();
  await act(async () => fold()!.click());
  await expect
    .poll(() => container.querySelector('[data-timeline-row-id="entry-a1"]'))
    .not.toBeNull();
  return Object.assign(screen, { threadKey });
};

const diffItem = (
  key: string,
  status: ForkTranscriptDiffItem["status"],
  kind: ForkTranscriptDiffItem["kind"] = "assistant",
): ForkTranscriptDiffItem => ({ key, kind, status, before: null, after: null });

const previewOf = (
  units: ReadonlyArray<ForkTranscriptUnitView>,
  diff: ReadonlyArray<ForkTranscriptDiffItem>,
  failedAt: ForkTranscriptPreviewResult["failedAt"] = null,
): ForkTranscriptPreviewResult => ({
  units,
  validation: { errors: [], warnings: [] },
  diff,
  failedAt,
});

const step = (id: string, label: string, unitKeys: ReadonlyArray<string>, ops: Step["items"]) => ({
  id,
  label,
  unitKeys,
  items: ops,
});

const seed = (
  threadKey: string,
  input: {
    readonly steps: ReadonlyArray<Step>;
    readonly preview: ForkTranscriptPreviewResult | null;
    readonly load?: ForkTranscriptLoadResult;
  },
) =>
  act(() =>
    appAtomRegistry.set(forkTranscriptEditSessionAtom(threadKey), {
      ...emptyEditSession,
      status: "ready",
      load: input.load ?? loadResult,
      history: { steps: input.steps, redo: [] },
      preview: input.preview,
    }),
  );

const session = (threadKey: string) =>
  appAtomRegistry.get(forkTranscriptEditSessionAtom(threadKey));

const lane = (container: HTMLElement, rowId: string) => {
  const row = container.querySelector<HTMLElement>(`[data-timeline-row-id="${rowId}"]`);
  if (row === null) throw new Error(`Missing row ${rowId}`);
  return row.closest<HTMLElement>("[data-timeline-root]")!;
};

const laneOfKind = (container: HTMLElement, kind: string) =>
  container
    .querySelector<HTMLElement>(`[data-timeline-row-kind="${kind}"]`)
    ?.closest<HTMLElement>("[data-timeline-root]") ?? null;

const buttonIn = (root: HTMLElement, name: string) => {
  const match = [...root.querySelectorAll<HTMLElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === name,
  );
  if (match === undefined) throw new Error(`Missing button ${name}`);
  return match;
};

describe("ForkTranscriptPending", () => {
  const ready = (previewResult: () => ForkTranscriptPreviewResult) => {
    rpc.load.mockReset();
    rpc.preview.mockReset();
    rpc.load.mockReturnValue(loadResult);
    rpc.preview.mockImplementation(previewResult);
  };

  it("shows the preview text and the Edited badge after an edit step", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, {
      steps: [
        step(
          "s1",
          "Edited assistant message",
          ["a1"],
          [
            {
              op: { kind: "editAssistantText", uuid: "a1", block: 0, text: "reply changed" },
              at: AT,
            },
          ],
        ),
      ],
      preview: previewOf(
        BASE_UNITS.map((item) =>
          item.key === "a1" ? unit("a1", "assistant", "reply changed") : item,
        ),
        [diffItem("a1", "changed")],
      ),
    });
    await expect
      .poll(() => lane(screen.container, "entry-a1").textContent)
      .toContain("reply changed");
    const root = lane(screen.container, "entry-a1");
    expect(root.textContent).not.toContain("reply one");
    expect(root.querySelector("[data-fork-transcript-badge]")?.textContent).toBe("Edited");
  });

  it("collapses a deleted tool row and restores it", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, {
      steps: [
        step(
          "s1",
          "Deleted tool call",
          ["t1"],
          [{ op: { kind: "deleteUnit", unit: "t1" }, at: AT }],
        ),
      ],
      preview: previewOf(
        BASE_UNITS.filter((item) => item.key !== "t1"),
        [diffItem("t1", "removed", "tool")],
      ),
    });
    await expect
      .poll(() => screen.container.querySelector('[data-fork-transcript-removed="t1"]'))
      .not.toBeNull();
    const removed = screen.container.querySelector<HTMLElement>(
      '[data-fork-transcript-removed="t1"]',
    )!;
    expect(removed.textContent).toContain("Removed");
    expect(laneOfKind(screen.container, "work")).toBeNull();
    await act(async () => buttonIn(removed, "Restore").click());
    expect(session(screen.threadKey).history.steps).toHaveLength(0);
    await expect.poll(() => laneOfKind(screen.container, "work")).not.toBeNull();
  });

  it("keeps the other units of a bulk delete removed after one Restore", async () => {
    ready(() =>
      previewOf(
        BASE_UNITS.filter((item) => item.key !== "a2"),
        [diffItem("a2", "removed")],
      ),
    );
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, {
      steps: [
        step(
          "s1",
          "Deleted 2 entries",
          ["a2", "a3"],
          [{ op: { kind: "deleteUnits", units: ["a2", "a3"] }, at: AT }],
        ),
      ],
      preview: previewOf(
        BASE_UNITS.filter((item) => item.key !== "a2" && item.key !== "a3"),
        [diffItem("a2", "removed"), diffItem("a3", "removed")],
      ),
    });
    await expect
      .poll(() => screen.container.querySelector('[data-fork-transcript-removed="a3"]'))
      .not.toBeNull();
    await act(async () =>
      buttonIn(
        screen.container.querySelector<HTMLElement>('[data-fork-transcript-removed="a3"]')!,
        "Restore",
      ).click(),
    );
    expect(
      session(screen.threadKey).history.steps.map((item) => item.items.map((p) => p.op)),
    ).toEqual([[{ kind: "deleteUnits", units: ["a2"] }]]);
    await expect
      .poll(() => screen.container.querySelector('[data-fork-transcript-removed="a3"]'))
      .toBeNull();
    expect(screen.container.querySelector('[data-fork-transcript-removed="a2"]')).not.toBeNull();
  });

  it("shows a moved unit at its old place and a Moved here draft after its new neighbor", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, {
      steps: [
        step(
          "s1",
          "Moved assistant message up",
          ["a4"],
          [{ op: { kind: "moveUnit", unit: "a4", toIndex: 1 }, at: AT }],
        ),
      ],
      preview: previewOf(
        [UNITS.u1, UNITS.a4, UNITS.a1, UNITS.t1, UNITS.a2, UNITS.a3],
        [diffItem("a4", "moved")],
      ),
    });
    await expect
      .poll(
        () => screen.container.querySelector('[data-fork-transcript-removed="a4"]')?.textContent,
      )
      .toContain("Moves after: Fix the parser");
    const old = screen.container.querySelector('[data-fork-transcript-removed="a4"]')!;
    expect(old.querySelector("[data-fork-transcript-badge]")?.textContent).toBe("Moved");
    const draft = lane(screen.container, "entry-u1").querySelector(
      '[data-fork-transcript-draft="a4"]',
    );
    expect(draft?.textContent).toContain("Moved here");
    expect(draft?.textContent).toContain("reply four");
  });

  it("shows an Inserted draft after its neighbor and removes it", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    const inserted = unit("n1", "user", "Also check the empty-file case.");
    await seed(screen.threadKey, {
      steps: [
        step(
          "s1",
          "Inserted message",
          ["n1", "a3"],
          [
            {
              op: {
                kind: "insertMessage",
                role: "user",
                text: inserted.excerpt,
                index: 5,
                uuid: "n1",
                timestamp: AT,
                messageId: null,
              },
              at: AT,
            },
          ],
        ),
      ],
      preview: previewOf(
        [UNITS.u1, UNITS.a1, UNITS.t1, UNITS.a2, UNITS.a3, inserted, UNITS.a4],
        [diffItem("n1", "added", "user")],
      ),
    });
    await expect
      .poll(() =>
        lane(screen.container, "entry-a3").querySelector('[data-fork-transcript-draft="n1"]'),
      )
      .not.toBeNull();
    const draft = lane(screen.container, "entry-a3").querySelector<HTMLElement>(
      '[data-fork-transcript-draft="n1"]',
    )!;
    expect(draft.textContent).toContain("Inserted");
    expect(draft.textContent).toContain("Also check the empty-file case.");
    await act(async () => buttonIn(draft, "Remove").click());
    expect(session(screen.threadKey).history.steps).toHaveLength(0);
  });

  it("shows a file entry without a timeline item as one line", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, {
      steps: [],
      preview: null,
      load: {
        ...loadResult,
        units: [UNITS.u1, unit("f1", "system", "hook output"), ...BASE_UNITS.slice(1)],
      },
    });
    await expect
      .poll(
        () =>
          lane(screen.container, "entry-u1").querySelector('[data-fork-transcript-draft="f1"]')
            ?.textContent,
      )
      .toContain("Not shown in the timeline: system entry");
    const draft = lane(screen.container, "entry-u1").querySelector<HTMLElement>(
      '[data-fork-transcript-draft="f1"]',
    )!;
    await act(async () => buttonIn(draft, "Edit").click());
    await expect
      .poll(() => screen.container.querySelector('[data-fork-transcript-edit-form="f1"]'))
      .not.toBeNull();
  });

  it("marks the row of a step that cannot apply", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, {
      steps: [
        step(
          "s1",
          "Edited assistant message",
          ["a1"],
          [{ op: { kind: "editAssistantText", uuid: "a1", block: 0, text: "x" }, at: AT }],
        ),
      ],
      preview: previewOf(BASE_UNITS, [], { index: 0, message: "The block is gone." }),
    });
    await expect
      .poll(
        () =>
          lane(screen.container, "entry-a1").querySelector("[data-fork-transcript-badge]")
            ?.textContent,
      )
      .toBe("Cannot apply");
    expect(
      lane(screen.container, "entry-a2").querySelector("[data-fork-transcript-badge]"),
    ).toBeNull();
  });

  it("inserts a message below a unit from the edit form menu", async () => {
    ready(() => previewOf(BASE_UNITS, []));
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await seed(screen.threadKey, { steps: [], preview: null });
    const row = lane(screen.container, "entry-u1");
    await userEvent.hover(row);
    await act(async () => buttonIn(row, "Edit").click());
    await expect
      .poll(() => screen.container.querySelector('[data-fork-transcript-edit-form="u1"]'))
      .not.toBeNull();
    const form = screen.container.querySelector<HTMLElement>(
      '[data-fork-transcript-edit-form="u1"]',
    )!;
    await act(async () => buttonIn(form, "More").click());
    const menuItem = () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate) => candidate.textContent === "Insert a message below",
      );
    await expect.poll(menuItem).toBeDefined();
    await act(async () => menuItem()!.click());
    await expect
      .poll(() => screen.container.querySelector("[data-fork-transcript-insert-composer]"))
      .not.toBeNull();
    const composer = screen.container.querySelector<HTMLElement>(
      "[data-fork-transcript-insert-composer]",
    )!;
    expect(screen.container.querySelector('[data-fork-transcript-edit-form="u1"]')).toBeNull();
    const textarea = composer.querySelector("textarea")!;
    await expect.poll(() => document.activeElement).toBe(textarea);
    await userEvent.type(textarea, "Run the tests too.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .poll(() => screen.container.querySelector("[data-fork-transcript-insert-composer]"))
      .toBeNull();
    const [added] = session(screen.threadKey).history.steps;
    expect(added?.label).toBe("Inserted message");
    const op = added?.items[0]?.op;
    expect(op?.kind === "insertMessage" ? [op.index, op.role, op.text] : null).toEqual([
      1,
      "user",
      "Run the tests too.",
    ]);
    await expect.poll(() => rpc.preview.mock.calls.length).toBe(1);
    expect(
      (rpc.preview.mock.calls[0]?.[0] as ForkTranscriptPreviewInput | undefined)?.ops,
    ).toHaveLength(1);
  });
});
