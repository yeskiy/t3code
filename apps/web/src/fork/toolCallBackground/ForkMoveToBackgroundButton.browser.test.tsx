import {
  EnvironmentId,
  NodeId,
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { LiveWorkEntryTimelineRow } from "~/components/chat/TimelineWorkGroupRows";
import { V2LifecycleRow } from "~/components/chat/V2LifecycleRow";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRow,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "~/components/chat/timelineRowContext";
import type { WorkLogEntry } from "~/session-logic";
import { ForkMoveToBackgroundButton } from "./ForkMoveToBackgroundButton";

const entry = (status: string): WorkLogEntry =>
  ({
    id: "item-1",
    createdAt: "2026-11-21T10:00:00.000Z",
    label: "Bash",
    tone: "tool",
    itemType: "command_execution",
    structuredPayload: {
      type: "command_execution",
      status,
      nativeItemRef: { driver: "claudeAgent", nativeId: "toolu_1" },
    } as unknown as OrchestrationV2TurnItem,
  }) as WorkLogEntry;

const renderButton = (input: {
  readonly status: string;
  readonly canOperateThread: boolean;
  readonly isWorking: boolean;
}) =>
  render(
    <TimelineRowCtx
      value={
        {
          threadRef: {
            environmentId: EnvironmentId.make("environment"),
            threadId: ThreadId.make("thread"),
          },
          canOperateThread: input.canOperateThread,
        } as unknown as TimelineRowSharedState
      }
    >
      <TimelineRowActivityCtx
        value={{ isWorking: input.isWorking } as unknown as TimelineRowActivityState}
      >
        <ForkMoveToBackgroundButton entry={entry(input.status)} />
      </TimelineRowActivityCtx>
    </TimelineRowCtx>,
    { router: false },
  );

describe("ForkMoveToBackgroundButton", () => {
  it("shows Move to background and Stop this command on a running Claude command in a live run", async () => {
    await using screen = await renderButton({
      status: "running",
      canOperateThread: true,
      isWorking: true,
    });
    await expect.element(screen.getByRole("button", { name: "Move to background" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Stop this command" })).toBeVisible();
  });

  it.each([
    { status: "completed", canOperateThread: true, isWorking: true },
    { status: "running", canOperateThread: false, isWorking: true },
    { status: "running", canOperateThread: true, isWorking: false },
  ])("stays hidden for $status, operate=$canOperateThread, live=$isWorking", async (input) => {
    await using screen = await renderButton(input);
    expect(screen.container.querySelector("button")).toBeNull();
  });

  it("shows on a live work-live command row without nesting buttons", async () => {
    const runningEntry = entry("running");
    const row = {
      kind: "work-live",
      id: "work-live:item-1",
      createdAt: runningEntry.createdAt,
      entry: runningEntry,
      groupedEntries: [runningEntry],
      groupId: "group-1",
      expanded: false,
      active: true,
    } as Extract<TimelineRow, { kind: "work-live" }>;
    await using screen = await render(
      <TimelineRowCtx
        value={
          {
            activeThreadEnvironmentId: EnvironmentId.make("environment"),
            threadRef: {
              environmentId: EnvironmentId.make("environment"),
              threadId: ThreadId.make("thread"),
            },
            canOperateThread: true,
            pendingApprovals: new Map(),
            onToggleWorkGroup: () => {},
          } as unknown as TimelineRowSharedState
        }
      >
        <TimelineRowActivityCtx value={{ isWorking: true } as unknown as TimelineRowActivityState}>
          <LiveWorkEntryTimelineRow row={row} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
      { router: false },
    );
    const moveButton = screen.getByRole("button", { name: "Move to background" });
    const stopButton = screen.getByRole("button", { name: "Stop this command" });
    await expect.element(moveButton).toBeVisible();
    await expect.element(stopButton).toBeVisible();
    expect(moveButton.element().parentElement?.closest("button")).toBeNull();
    expect(stopButton.element().parentElement?.closest("button")).toBeNull();
  });

  it("shows on a running Claude subagent lifecycle row without nesting buttons", async () => {
    const subagentItem = {
      id: TurnItemId.make("item-sub-1"),
      threadId: ThreadId.make("thread"),
      type: "subagent",
      status: "running",
      subagentId: NodeId.make("node-sub-1"),
      origin: "provider",
      driver: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      nativeItemRef: { driver: "claudeAgent", nativeId: "task-sub-1", strength: "strong" },
      title: "Foreground subagent",
      result: null,
      progress: undefined,
      startedAt: null,
      completedAt: null,
      childThreadId: ThreadId.make("child-thread-1"),
    } as unknown as OrchestrationV2TurnItem;
    await using screen = await render(
      <TimelineRowCtx
        value={
          {
            activeThreadEnvironmentId: EnvironmentId.make("environment"),
            threadRef: {
              environmentId: EnvironmentId.make("environment"),
              threadId: ThreadId.make("thread"),
            },
            canOperateThread: true,
          } as unknown as TimelineRowSharedState
        }
      >
        <TimelineRowActivityCtx value={{ isWorking: true } as unknown as TimelineRowActivityState}>
          <V2LifecycleRow
            environmentId={EnvironmentId.make("environment")}
            item={subagentItem}
            runs={[]}
            onOpenThread={() => {}}
          />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>,
    );
    const moveButton = screen.getByRole("button", { name: "Move to background" });
    const stopButton = screen.getByRole("button", { name: "Stop this command" });
    await expect.element(moveButton).toBeVisible();
    await expect.element(stopButton).toBeVisible();
    expect(moveButton.element().parentElement?.closest("button")).toBeNull();
    expect(stopButton.element().parentElement?.closest("button")).toBeNull();
  });
});
