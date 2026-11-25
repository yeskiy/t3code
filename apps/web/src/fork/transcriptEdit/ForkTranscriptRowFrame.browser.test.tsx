import {
  EnvironmentId,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPreviewInput,
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
import { forkTranscriptEditSessionAtom } from "./editSession";
import { FORK_TRANSCRIPT_EDIT_ENABLED_KEY } from "./transcriptEditSetting";

const rpc = vi.hoisted(() => ({
  load: vi.fn<(input: unknown) => unknown>(),
  preview: vi.fn<(input: unknown) => unknown>(),
  blockText: vi.fn<(input: unknown) => unknown>(),
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
    forkTranscriptBlockText: command("blockText", (input) => rpc.blockText(input)),
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
  messageId: string | null,
): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: CREATED_AT,
  blocks: [
    {
      uuid: key,
      index: kind === "user" ? null : 0,
      type: "text",
      text,
      truncated: false,
      editable: true,
      removable: false,
    },
  ],
  entries: [
    {
      uuid: key,
      parentUuid: null,
      type: kind,
      timestamp: CREATED_AT,
      messageId,
      model: null,
      raw: `{"uuid":"${key}"}`,
      rawTruncated: false,
    },
  ],
  hidden: [],
  excerpt: text,
});

const loadResult: ForkTranscriptLoadResult = {
  sessionId: "session-1",
  baseKey: "key-1",
  units: [
    unit("u1", "user", "Fix the parser", null),
    unit("a1", "assistant", "reply one", "msg_1"),
  ],
  links: [
    { itemId: "item-u1", unitKey: "u1", inherited: false },
    { itemId: "item-a1", unitKey: "a1", inherited: false },
  ],
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

const makeEntries = (): ReadonlyArray<Entry> => [
  {
    id: "entry-u1",
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make("message-u1"),
      role: "user",
      text: "Fix the parser",
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
    },
    projectedItem: v2Item("user_message", "item-u1"),
  },
  {
    id: "entry-a1",
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make("message-a1"),
      role: "assistant",
      text: "reply one",
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
    },
    projectedItem: v2Item("assistant_message", "item-a1"),
  },
];

// Item support atoms are cached per source thread, so each test uses a fresh one.
const mockThread = (driver: string) => {
  sourceThread.id = `thread-${Math.random().toString(36).slice(2)}`;
  return vi.spyOn(environmentThreadDetails, "threadAtom").mockReturnValue(
    Atom.make({
      projection: {
        thread: { activeProviderThreadId: "provider-thread-1" },
        turnItems: [
          { ...(v2Item("user_message", "item-u1") as { item: object }).item },
          { ...(v2Item("assistant_message", "item-a1") as { item: object }).item },
        ],
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

const stepCount = (threadKey: string) =>
  appAtomRegistry.get(forkTranscriptEditSessionAtom(threadKey)).history.steps.length;

const settingOff = () => {
  localStorage.setItem(FORK_TRANSCRIPT_EDIT_ENABLED_KEY, "false");
  return { [Symbol.dispose]: () => localStorage.removeItem(FORK_TRANSCRIPT_EDIT_ENABLED_KEY) };
};

const editButtons = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit"]'),
];

const rowElement = (container: HTMLElement, rowId: string) => {
  const row = container.querySelector<HTMLElement>(`[data-timeline-row-id="${rowId}"]`);
  if (row === null) throw new Error(`Missing row ${rowId}`);
  return row;
};

const openAssistantForm = async (container: HTMLElement) => {
  const row = rowElement(container, "entry-a1");
  await userEvent.hover(row);
  const button = row.querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
  if (button === null) throw new Error("Missing Edit button");
  await act(async () => button.click());
  await expect.poll(() => container.querySelector("textarea")).not.toBeNull();
  return container.querySelector("textarea")!;
};

describe("ForkTranscriptRowFrame", () => {
  const ready = () => {
    rpc.load.mockReset();
    rpc.preview.mockReset();
    rpc.blockText.mockReset();
    rpc.load.mockReturnValue(loadResult);
    rpc.preview.mockImplementation((input) => ({
      units: loadResult.units,
      validation: loadResult.validation,
      diff: [],
      failedAt: null,
      ops: (input as ForkTranscriptPreviewInput).ops,
    }));
  };

  it("shows the Edit button on hover for a user row and an assistant row", async () => {
    ready();
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    const container = screen.container;
    await expect.poll(() => editButtons(container).length).toBe(2);
    const assistantRow = rowElement(container, "entry-a1");
    await userEvent.hover(assistantRow);
    await expect
      .element(assistantRow.querySelector<HTMLElement>('button[aria-label="Edit"]')!)
      .toBeVisible();
    const userRow = rowElement(container, "entry-u1");
    await userEvent.hover(userRow);
    await expect
      .element(userRow.querySelector<HTMLElement>('button[aria-label="Edit"]')!)
      .toBeVisible();
  });

  it("loads once and opens a text field with the row text in place", async () => {
    ready();
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    const textarea = await openAssistantForm(screen.container);
    expect(rpc.load).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("reply one");
    expect(textarea.closest('[data-fork-transcript-edit-form="a1"]')).not.toBeNull();
    expect(screen.container.querySelector('[data-timeline-row-id="entry-a1"]')).toBeNull();
  });

  it("adds one step on Mod+Enter, closes the form, and calls preview", async () => {
    ready();
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    const textarea = await openAssistantForm(screen.container);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "reply two");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect.poll(() => screen.container.querySelector("textarea")).toBeNull();
    expect(stepCount(screen.threadKey)).toBe(1);
    await expect.poll(() => rpc.preview.mock.calls.length).toBe(1);
    const input = rpc.preview.mock.calls[0]?.[0] as ForkTranscriptPreviewInput;
    expect(input.ops.map((pending) => pending.op)).toEqual([
      { kind: "editAssistantText", uuid: "a1", block: 0, text: "reply two" },
    ]);
  });

  it("closes the form on Escape and adds no step", async () => {
    ready();
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    const textarea = await openAssistantForm(screen.container);
    await userEvent.type(textarea, " more");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.container.querySelector("textarea")).toBeNull();
    expect(stepCount(screen.threadKey)).toBe(0);
    expect(rowElement(screen.container, "entry-a1").textContent).toContain("reply one");
  });

  it("lists the uuid and the message id under Entry fields", async () => {
    ready();
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await openAssistantForm(screen.container);
    const toggle = [...screen.container.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent === "Entry fields",
    );
    if (toggle === undefined) throw new Error("Missing Entry fields");
    await act(async () => toggle.click());
    const form = () => screen.container.querySelector('[data-fork-transcript-edit-form="a1"]');
    await expect.poll(() => form()?.textContent).toContain("msg_1");
    expect(form()?.textContent).toContain("UUIDa1");
  });

  it("shows the Edit button disabled with a reason on a Codex thread", async () => {
    ready();
    using _thread = mockThread("codex");
    await using screen = await renderTimeline();
    await expect.poll(() => editButtons(screen.container).length).toBe(2);
    const button = rowElement(screen.container, "entry-a1").querySelector<HTMLButtonElement>(
      'button[aria-label="Edit"]',
    )!;
    expect(button.disabled).toBe(true);
    await userEvent.hover(button.parentElement!);
    await expect
      .poll(() => document.body.textContent)
      .toContain("Transcript editing works for Claude threads only.");
  });

  it("renders no Edit button when the setting is off", async () => {
    ready();
    using _setting = settingOff();
    using _thread = mockThread("claudeAgent");
    await using screen = await renderTimeline();
    await expect.poll(() => screen.container.textContent).toContain("reply one");
    expect(editButtons(screen.container)).toHaveLength(0);
  });
});
