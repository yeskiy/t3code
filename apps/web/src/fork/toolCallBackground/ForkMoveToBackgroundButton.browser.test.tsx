import { EnvironmentId, type OrchestrationV2TurnItem, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
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
  it("shows on a running Claude command in a live run", async () => {
    await using screen = await renderButton({
      status: "running",
      canOperateThread: true,
      isWorking: true,
    });
    await expect.element(screen.getByRole("button", { name: "Move to background" })).toBeVisible();
  });

  it.each([
    { status: "completed", canOperateThread: true, isWorking: true },
    { status: "running", canOperateThread: false, isWorking: true },
    { status: "running", canOperateThread: true, isWorking: false },
  ])("stays hidden for $status, operate=$canOperateThread, live=$isWorking", async (input) => {
    await using screen = await renderButton(input);
    expect(screen.container.querySelector("button")).toBeNull();
  });
});
