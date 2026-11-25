import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveRevertTurnCountByUserMessageId, type TimelineEntry } from "../../session-logic";

describe("rewind after a failed run", () => {
  it("gives the user message after a failed run a rewind target when that run has a checkpoint", () => {
    const failedRunId = RunId.make("run-1");
    const nextRunId = RunId.make("run-2");
    const failedUserMessageId = MessageId.make("user-1");
    const nextUserMessageId = MessageId.make("user-2");

    const timelineEntries: ReadonlyArray<TimelineEntry> = [
      {
        id: failedUserMessageId,
        kind: "message",
        createdAt: "2026-11-25T10:00:01.000Z",
        message: {
          id: failedUserMessageId,
          role: "user",
          text: "First prompt",
          runId: failedRunId,
          inputIntent: "turn_start",
          streaming: false,
          createdAt: "2026-11-25T10:00:01.000Z",
          updatedAt: "2026-11-25T10:00:01.000Z",
        },
      },
      {
        id: nextUserMessageId,
        kind: "message",
        createdAt: "2026-11-25T10:00:05.000Z",
        message: {
          id: nextUserMessageId,
          role: "user",
          text: "Retry after failure",
          runId: nextRunId,
          inputIntent: "turn_start",
          streaming: false,
          createdAt: "2026-11-25T10:00:05.000Z",
          updatedAt: "2026-11-25T10:00:05.000Z",
        },
      },
    ];

    const targets = deriveRevertTurnCountByUserMessageId({
      timelineEntries,
      threadStartCheckpointAvailable: true,
      checkpoints: [
        {
          runId: failedRunId,
          checkpointTurnCount: 1,
          checkpointRef: "checkpoint-failed-1" as never,
          status: "missing",
          files: [],
          assistantMessageId: null,
          completedAt: "2026-11-25T10:00:02.000Z",
        },
      ],
    });

    expect(targets.get(failedUserMessageId)).toBe(0);
    expect(targets.get(nextUserMessageId)).toBe(1);
  });
});
