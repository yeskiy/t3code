import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";
import { isMovableToolCall, newestMovableToolCall } from "./runningToolCall.logic";

const entry = (input: {
  readonly id?: string;
  readonly itemType: string;
  readonly status: string;
  readonly driver?: string;
  readonly createdAt?: string;
}): WorkLogEntry =>
  ({
    id: input.id ?? "item-1",
    createdAt: input.createdAt ?? "2026-11-21T10:00:00.000Z",
    label: "Bash",
    tone: "tool",
    itemType: input.itemType,
    structuredPayload: {
      type: input.itemType,
      status: input.status,
      nativeItemRef: { driver: input.driver ?? "claudeAgent", nativeId: "toolu_1" },
    } as unknown as OrchestrationV2TurnItem,
  }) as WorkLogEntry;

const work = (value: WorkLogEntry): TimelineEntry => ({
  id: value.id,
  kind: "work",
  createdAt: value.createdAt,
  entry: value,
});

describe("isMovableToolCall", () => {
  it.each([
    {
      itemType: "command_execution",
      status: "running",
      driver: "claudeAgent",
      live: true,
      expected: true,
    },
    { itemType: "subagent", status: "running", driver: "claudeAgent", live: true, expected: true },
    {
      itemType: "command_execution",
      status: "completed",
      driver: "claudeAgent",
      live: true,
      expected: false,
    },
    {
      itemType: "command_execution",
      status: "waiting",
      driver: "claudeAgent",
      live: true,
      expected: false,
    },
    {
      itemType: "file_change",
      status: "running",
      driver: "claudeAgent",
      live: true,
      expected: false,
    },
    {
      itemType: "command_execution",
      status: "running",
      driver: "codex",
      live: true,
      expected: false,
    },
    {
      itemType: "command_execution",
      status: "running",
      driver: "claudeAgent",
      live: false,
      expected: false,
    },
  ] as const)("$itemType $status $driver live=$live -> $expected", (row) => {
    expect(isMovableToolCall(entry(row), { runLive: row.live, enabled: true })).toBe(row.expected);
  });

  it("is false when the fork flag is off", () => {
    expect(
      isMovableToolCall(entry({ itemType: "command_execution", status: "running" }), {
        runLive: true,
        enabled: false,
      }),
    ).toBe(false);
  });
});

describe("newestMovableToolCall", () => {
  it("picks the newest movable work entry", () => {
    const older = entry({ id: "a", itemType: "command_execution", status: "running" });
    const newer = entry({
      id: "b",
      itemType: "subagent",
      status: "running",
      createdAt: "2026-11-21T10:05:00.000Z",
    });
    const done = entry({
      id: "c",
      itemType: "command_execution",
      status: "completed",
      createdAt: "2026-11-21T10:09:00.000Z",
    });
    expect(
      newestMovableToolCall([work(older), work(newer), work(done)], {
        runLive: true,
        enabled: true,
      })?.id,
    ).toBe("b");
  });

  it("is null when nothing can move", () => {
    expect(
      newestMovableToolCall([work(entry({ itemType: "command_execution", status: "completed" }))], {
        runLive: true,
        enabled: true,
      }),
    ).toBeNull();
  });
});
