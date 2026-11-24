/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { isPullRequestWatchTask } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

export type ComposerStopDecision = "stop-turn" | "confirm-stop-all" | "none";

export interface ComposerStopState {
  readonly turnRunning: boolean;
  readonly backgroundCount: number;
}

export interface BackgroundWorkTurnItemRef {
  readonly id: string;
  readonly type: string;
  readonly origin?: string | undefined;
  readonly nativeItemRef?: { readonly nativeId: string | null } | null | undefined;
}

export function decideComposerStop(state: ComposerStopState): ComposerStopDecision {
  if (state.turnRunning) return "stop-turn";
  if (state.backgroundCount > 0) return "confirm-stop-all";
  return "none";
}

export function composerStopLabel(state: ComposerStopState): string | undefined {
  if (state.turnRunning) {
    return state.backgroundCount > 0 ? "Stop turn (background work keeps running)" : "Stop turn";
  }
  if (state.backgroundCount > 0) {
    return "Stop background work";
  }
  return undefined;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinList(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function isDelegatedTask(
  task: OrchestrationV2PendingBackgroundTask,
  turnItems: ReadonlyArray<BackgroundWorkTurnItemRef>,
): boolean {
  if (task.kind !== "subagent") return false;
  const itemKey = task.nativeItemId ?? task.taskId;
  const match = turnItems.findLast(
    (candidate) => (candidate.nativeItemRef?.nativeId || candidate.id) === itemKey,
  );
  return match?.type === "subagent" && match.origin === "app_owned";
}

export function formatStopBackgroundConfirmDescription(
  tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>,
  turnItems: ReadonlyArray<BackgroundWorkTurnItemRef> = [],
): string {
  if (tasks.length === 0) {
    return "Background work is running. All background work will stop.";
  }

  let commands = 0;
  let subagents = 0;
  let delegatedTasks = 0;
  let monitors = 0;
  let pullRequestWatches = 0;
  let backgroundTasks = 0;

  for (const task of tasks) {
    switch (task.kind) {
      case "command":
        commands += 1;
        break;
      case "subagent":
        if (isDelegatedTask(task, turnItems)) delegatedTasks += 1;
        else subagents += 1;
        break;
      case "monitor":
        if (isPullRequestWatchTask(task)) pullRequestWatches += 1;
        else monitors += 1;
        break;
      case "background_task":
        backgroundTasks += 1;
        break;
    }
  }

  const parts: string[] = [];
  if (commands > 0) parts.push(pluralize(commands, "command", "commands"));
  if (subagents > 0) parts.push(pluralize(subagents, "subagent", "subagents"));
  if (delegatedTasks > 0) {
    parts.push(pluralize(delegatedTasks, "delegated task", "delegated tasks"));
  }
  if (monitors > 0) parts.push(pluralize(monitors, "monitor", "monitors"));
  if (pullRequestWatches > 0) {
    parts.push(pluralize(pullRequestWatches, "pull request watch", "pull request watches"));
  }
  if (backgroundTasks > 0) {
    parts.push(pluralize(backgroundTasks, "background task", "background tasks"));
  }

  const verb = tasks.length === 1 ? "is" : "are";
  return `${joinList(parts)} ${verb} running in the background. All background work will stop.`;
}
