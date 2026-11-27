import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { backgroundTaskStopRoute } from "./backgroundTaskStop.logic";

const threadId = ThreadId.make("thread");
const command = (driver: string, status: string) =>
  ({
    id: TurnItemId.make("item-1"),
    threadId,
    type: "command_execution",
    status,
    input: "sleep 600",
    nativeItemRef: { driver, nativeId: "toolu_1", strength: "strong" },
  }) as unknown as ThreadStructure["turnItems"][number];
const route = (item: ThreadStructure["turnItems"][number] | undefined, taskId = "toolu_1") =>
  backgroundTaskStopRoute({
    threadId,
    task: { taskId, kind: "command" },
    turnItems: item === undefined ? [] : [item],
  });

describe("backgroundTaskStopRoute", () => {
  it("stops a running Claude command item as a tool call", () => {
    expect(route(command("claudeAgent", "running"))).toEqual({
      kind: "tool-call",
      threadId,
      itemId: "item-1",
    });
  });

  it("offers no Stop for another provider, a finished item, or the scheduled wakeup", () => {
    expect(route(command("codex", "running"))).toBeNull();
    expect(route(command("claudeAgent", "completed"))).toBeNull();
    expect(route(undefined, "claude-scheduled-wakeup")).toBeNull();
  });

  it("stops a roster task that has no turn item by its task id", () => {
    expect(route(undefined, "b7k2")).toEqual({ kind: "roster", threadId, taskId: "b7k2" });
  });
});
