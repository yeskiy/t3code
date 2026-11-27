import {
  isOrchestrationV2WorkActive,
  type NodeId,
  type OrchestrationV2PendingBackgroundTask,
  type ThreadId,
  type TurnItemId,
} from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { isPullRequestWatchTask } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

type TurnItem = ThreadStructure["turnItems"][number];

/** How one Stop in the Background work list reaches the server. */
export type BackgroundTaskStopRoute =
  | { readonly kind: "subagent"; readonly threadId: ThreadId; readonly subagentId: NodeId }
  | { readonly kind: "tool-call"; readonly threadId: ThreadId; readonly itemId: TurnItemId }
  | { readonly kind: "roster"; readonly threadId: ThreadId; readonly taskId: string };

const CLAUDE_SCHEDULED_WAKEUP_TASK_ID = "claude-scheduled-wakeup";
const CLAUDE = "claudeAgent";

const isShellItem = (item: TurnItem) =>
  item.type === "command_execution" ||
  (item.type === "dynamic_tool" &&
    ["bash", "powershell"].includes((item.toolName ?? "").toLowerCase().replaceAll(/[\s_-]/g, "")));

const itemKey = (item: TurnItem) => item.nativeItemRef?.nativeId || item.id;

export const backgroundTaskItem = (
  task: OrchestrationV2PendingBackgroundTask,
  turnItems: ReadonlyArray<TurnItem>,
): TurnItem | undefined =>
  turnItems.findLast((candidate) =>
    task.itemId === undefined
      ? itemKey(candidate) === (task.nativeItemId ?? task.taskId) ||
        itemKey(candidate) === task.taskId
      : candidate.id === task.itemId,
  );

export const backgroundTaskLabel = (
  task: OrchestrationV2PendingBackgroundTask,
  item: TurnItem | undefined,
) =>
  task.description?.trim() ||
  task.command?.trim() ||
  (item?.type === "command_execution" ? item.input.trim() : "") ||
  (item?.type === "subagent" ? item.prompt.trim() : "") ||
  task.kind.replaceAll("_", " ");

export const backgroundTaskStopRoute = (input: {
  readonly threadId: ThreadId;
  readonly task: OrchestrationV2PendingBackgroundTask;
  readonly turnItems: ReadonlyArray<TurnItem>;
}): BackgroundTaskStopRoute | null => {
  const { task } = input;
  if (isPullRequestWatchTask(task) || task.taskId === CLAUDE_SCHEDULED_WAKEUP_TASK_ID) return null;
  const item = backgroundTaskItem(task, input.turnItems);
  if (item?.type === "subagent") {
    return isOrchestrationV2WorkActive(item.status) &&
      (item.origin === "app_owned" || item.driver === CLAUDE)
      ? { kind: "subagent", threadId: item.threadId, subagentId: item.subagentId }
      : null;
  }
  if (task.kind === "subagent") return null;
  if (item !== undefined && item.nativeItemRef?.driver !== CLAUDE) return null;
  // A pending task from a running turn item has no roster entry. Its key is the item key.
  if (item !== undefined && itemKey(item) === task.taskId) {
    return item.status === "running" && isShellItem(item)
      ? { kind: "tool-call", threadId: item.threadId, itemId: item.id }
      : null;
  }
  return { kind: "roster", threadId: input.threadId, taskId: task.taskId };
};

/** Work inside the Claude process, which a Claude restart would end. */
export const endsWithClaudeRestart = (route: BackgroundTaskStopRoute, item: TurnItem | undefined) =>
  route.kind !== "subagent" || (item?.type === "subagent" && item.origin === "provider_native");
