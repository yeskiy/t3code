import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { TimelineEntry, WorkLogEntry } from "~/session-logic";

export const FORK_TOOL_BACKGROUND_KEY = "t3code:fork:tool-background:v1";
export const ForkToolBackgroundEnabled = Schema.Boolean;

interface MovableInput {
  readonly runLive: boolean;
  readonly enabled: boolean;
  readonly turnWaitingOnly?: boolean;
}

export interface MovableToolCallCandidate {
  readonly id: string;
  readonly createdAt: string;
}

const isShellDynamicToolName = (toolName: string | null | undefined) => {
  if (toolName == null) return false;
  const normalized = toolName.toLowerCase().replaceAll(/[\s_-]/g, "");
  return normalized === "bash" || normalized === "powershell";
};

export const isStoppableTurnItem = (
  item: OrchestrationV2TurnItem | undefined,
  input: MovableInput,
) =>
  input.enabled &&
  input.runLive &&
  item?.nativeItemRef?.driver === "claudeAgent" &&
  item.status === "running" &&
  (item.type === "command_execution" ||
    item.type === "subagent" ||
    (item.type === "dynamic_tool" && isShellDynamicToolName(item.toolName)));

export const isMovableTurnItem = (item: OrchestrationV2TurnItem | undefined, input: MovableInput) =>
  isStoppableTurnItem(item, input) &&
  !(item?.type === "subagent" && (item.backgrounded === true || input.turnWaitingOnly === true));

export const isStoppableToolCall = (entry: WorkLogEntry, input: MovableInput) =>
  isStoppableTurnItem(entry.structuredPayload, input);

export const isMovableToolCall = (entry: WorkLogEntry, input: MovableInput) =>
  isMovableTurnItem(entry.structuredPayload, input);

const matchingCandidate = (
  entry: TimelineEntry,
  predicate: (item: OrchestrationV2TurnItem | undefined) => boolean,
): MovableToolCallCandidate | null => {
  if (entry.kind === "work") {
    return predicate(entry.entry.structuredPayload)
      ? { id: entry.entry.id, createdAt: entry.entry.createdAt }
      : null;
  }
  if (entry.kind === "event") {
    return predicate(entry.projectedItem.item)
      ? { id: entry.id, createdAt: entry.createdAt }
      : null;
  }
  return null;
};

const newestMatchingToolCall = (
  entries: ReadonlyArray<TimelineEntry>,
  predicate: (item: OrchestrationV2TurnItem | undefined) => boolean,
): MovableToolCallCandidate | null =>
  entries
    .flatMap((entry) => {
      const candidate = matchingCandidate(entry, predicate);
      return candidate === null ? [] : [candidate];
    })
    .reduce<MovableToolCallCandidate | null>(
      (newest, entry) => (newest === null || entry.createdAt > newest.createdAt ? entry : newest),
      null,
    );

export const newestMovableToolCall = (
  entries: ReadonlyArray<TimelineEntry>,
  input: MovableInput,
): MovableToolCallCandidate | null =>
  newestMatchingToolCall(entries, (item) => isMovableTurnItem(item, input));

export const newestStoppableToolCall = (
  entries: ReadonlyArray<TimelineEntry>,
  input: MovableInput,
): MovableToolCallCandidate | null =>
  newestMatchingToolCall(entries, (item) => isStoppableTurnItem(item, input));
