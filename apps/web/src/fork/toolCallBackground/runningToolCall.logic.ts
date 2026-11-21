import * as Schema from "effect/Schema";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

export const FORK_TOOL_BACKGROUND_KEY = "t3code:fork:tool-background:v1";
export const ForkToolBackgroundEnabled = Schema.Boolean;

interface MovableInput {
  readonly runLive: boolean;
  readonly enabled: boolean;
}

export const isMovableToolCall = (entry: WorkLogEntry, input: MovableInput) =>
  input.enabled &&
  input.runLive &&
  entry.structuredPayload?.nativeItemRef?.driver === "claudeAgent" &&
  entry.structuredPayload.status === "running" &&
  (entry.itemType === "command_execution" || entry.itemType === "subagent");

export const newestMovableToolCall = (entries: ReadonlyArray<TimelineEntry>, input: MovableInput) =>
  entries
    .flatMap((entry) => (entry.kind === "work" ? [entry.entry] : []))
    .filter((entry) => isMovableToolCall(entry, input))
    .reduce<WorkLogEntry | null>(
      (newest, entry) => (newest === null || entry.createdAt > newest.createdAt ? entry : newest),
      null,
    );
