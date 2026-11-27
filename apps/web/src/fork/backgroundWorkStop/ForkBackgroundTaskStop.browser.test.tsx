import "~/index.css";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  MessageId,
  NodeId,
  type OrchestrationV2PendingBackgroundTask,
  ProviderDriverKind,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(async (_route: unknown, _label: string) => true),
  startTurn: vi.fn(async (_input: unknown) => ({ _tag: "Success" as const, value: undefined })),
}));
vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
}));
vi.mock(import("./useForkBackgroundTaskStop"), () => ({
  useForkBackgroundTaskStop: () => mocks.stop,
}));
vi.mock(import("~/state/use-orchestration-command"), () => ({
  useOrchestrationCommand: (() => mocks.startTurn) as never,
}));

import { render } from "../../../test/render";
import { backgroundWorkNowItem } from "~/components/chat/ThreadActivityBanners";
import { ThreadNow } from "~/components/chat/ThreadNow";
import { ForkRestartBlockedPanel } from "./ForkRestartBlockedActions";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const claude = ProviderDriverKind.make("claudeAgent");
const at = DateTime.makeUnsafe("2026-11-27T10:00:00Z");

const base = (id: string, nativeId: string | null, status: string) => ({
  id: TurnItemId.make(id),
  threadId,
  runId: RunId.make("run-1"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef:
    nativeId === null ? null : { driver: claude, nativeId, strength: "strong" as const },
  parentItemId: null,
  ordinal: 1,
  status,
  title: null,
  startedAt: at,
  completedAt: null,
  updatedAt: at,
});
const viteItem = {
  ...base("item-vite", "toolu_vite", "completed"),
  type: "command_execution",
  input: "npx vite preview --port 5318",
  output: "Command running in background with ID: b7k2",
};
const subagent = (id: string, origin: "provider_native" | "app_owned", prompt: string) => ({
  ...base(id, origin === "provider_native" ? `native-${id}` : null, "running"),
  type: "subagent",
  subagentId: NodeId.make(`node-${id}`),
  origin,
  driver: claude,
  providerInstanceId: "claudeAgent",
  childThreadId: ThreadId.make(`child-${id}`),
  prompt,
  result: null,
});
const turnItems = [
  viteItem,
  subagent("research", "provider_native", "Research the bug"),
  subagent("delegated", "app_owned", "Fix the tests"),
] as unknown as ThreadStructure["turnItems"];
const rosterTask: OrchestrationV2PendingBackgroundTask = {
  taskId: "b7k2",
  kind: "command",
  command: "npx vite preview --port 5318",
  nativeItemId: "toolu_vite",
};
const tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask> = [
  rosterTask,
  { taskId: "native-research", kind: "subagent", description: "Research the bug" },
  { taskId: "delegated", kind: "subagent", description: "Fix the tests" },
  {
    taskId: "pull-request-watch:github.com/acme/app#7",
    kind: "monitor",
    description: "Watching pull request #7",
  },
];

describe("Background work Stop per item", () => {
  it("stops one command, one Claude subagent, and one delegated task, and skips a PR watch", async () => {
    mocks.stop.mockClear();
    await using screen = await render(
      <ThreadNow
        attention={null}
        syncPhase={null}
        goal={null}
        work={backgroundWorkNowItem({
          environmentId,
          threadId,
          tasks,
          turnItems,
          stopDisabled: false,
          stopping: false,
          onStop: async () => undefined,
          onOpenThread: () => undefined,
        })}
      />,
    );
    await screen.getByRole("button", { name: "Details", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const command = dialog.getByRole("button", { name: "Stop npx vite preview --port 5318" });
    await expect.element(command).toBeVisible();
    await expect
      .element(dialog.getByRole("button", { name: "Stop Watching pull request #7" }))
      .not.toBeInTheDocument();

    await command.click();
    await expect.element(command).toBeDisabled();
    await dialog.getByRole("button", { name: "Stop Research the bug" }).click();
    await dialog.getByRole("button", { name: "Stop Fix the tests" }).click();
    expect(mocks.stop.mock.calls.map(([route]) => route)).toEqual([
      { kind: "roster", threadId, taskId: "b7k2" },
      { kind: "subagent", threadId, subagentId: NodeId.make("node-research") },
      { kind: "subagent", threadId, subagentId: NodeId.make("node-delegated") },
    ]);
    await expect.element(dialog.getByRole("button", { name: "Stop Fix the tests" })).toBeDisabled();
  });
});

describe("Restart blocked panel", () => {
  const runId = RunId.make("run-2");
  const userMessageId = MessageId.make("message-2");
  const projection = (roster: ReadonlyArray<OrchestrationV2PendingBackgroundTask>) =>
    ({
      thread: {
        id: threadId,
        providerInstanceId: "claudeAgent",
        activeProviderThreadId: "provider-thread",
        runtimeMode: "full-access",
        interactionMode: "default",
        pullRequests: [],
      },
      providerSessions: [],
      providerThreads: [{ id: "provider-thread", pendingBackgroundTasks: roster }],
      runs: [
        {
          id: runId,
          status: "failed",
          userMessageId,
          modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
        },
      ],
      messages: [{ id: userMessageId, text: "Use Sonnet now.", attachments: [] }],
      turnItems: [viteItem, subagent("delegated", "app_owned", "Fix the tests")],
    }) as unknown as ThreadStructure;

  it("lists only Claude process work and stops it, then sends the message again", async () => {
    mocks.stop.mockClear();
    mocks.startTurn.mockClear();
    const pendingIds = new Set(["b7k2"]);
    await using screen = await render(
      <ForkRestartBlockedPanel
        threadRef={{ environmentId, threadId }}
        runId={runId}
        canOperate
        projection={projection([rosterTask])}
        readPendingTaskIds={() => pendingIds}
      />,
      { router: false },
    );
    await expect.element(screen.getByText("npx vite preview --port 5318")).toBeVisible();
    await expect.element(screen.getByText("Fix the tests")).not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Stop it and send again" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Waiting for the tasks to end..." }))
      .toBeDisabled();
    expect(mocks.stop).toHaveBeenCalledWith(
      { kind: "roster", threadId, taskId: "b7k2" },
      "npx vite preview --port 5318",
    );
    expect(mocks.startTurn).not.toHaveBeenCalled();

    pendingIds.delete("b7k2");
    await vi.waitFor(() => expect(mocks.startTurn).toHaveBeenCalledTimes(1));
    expect(mocks.startTurn.mock.calls[0]?.[0]).toMatchObject({
      environmentId,
      input: {
        threadId,
        message: { role: "user", text: "Use Sonnet now.", attachments: [] },
        modelSelection: { model: "claude-sonnet-5-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });
  });
});
