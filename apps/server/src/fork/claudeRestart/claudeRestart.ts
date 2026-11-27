import type {
  ClaudeRestartBlockingItem,
  ClaudeRestartReason,
  OrchestrationV2PendingBackgroundTask,
} from "@t3tools/contracts";
import type { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import { buildWorkspaceInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

type WorkspacePolicy = Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace">;

const CLAUDE_WORKSPACE_CONTEXT_KEY = "workspace_folders";
const NO_FOLDERS_TEXT = "This project no longer spans several folders.";

/** Only roots outside `cwd` reach the launch, so a folder inside `cwd` keeps the process. */
export const claudeWorkspaceQueryKey = (workspace: WorkspacePolicy["workspace"]) =>
  workspace === undefined || workspace.extraRoots.length === 0
    ? undefined
    : workspace.extraRoots.toSorted();

/** Adds the current folder list to `message` when the process knows a different one. */
export const claudeWorkspaceUpdate = <M>(input: {
  readonly known: string;
  readonly policy: WorkspacePolicy;
  readonly message: M;
  readonly skip: boolean;
  readonly addContext: (message: M, entry: { readonly key: string; readonly text: string }) => M;
}): { readonly message: M; readonly known: string } => {
  const next = buildWorkspaceInstructions(input.policy);
  if (input.skip || next === input.known) return { message: input.message, known: input.known };
  const message = input.addContext(input.message, {
    key: CLAUDE_WORKSPACE_CONTEXT_KEY,
    text: next || NO_FOLDERS_TEXT,
  });
  return { message, known: message === input.message ? input.known : next };
};

const keyField = (key: string, field: string) =>
  JSON.stringify((JSON.parse(key) as Record<string, unknown>)[field]);

/** Names the first part of the query key that changed, in the order a user acts on it. */
export const claudeRestartReason = (input: {
  readonly sameSession: boolean;
  readonly previousKey: string;
  readonly nextKey: string;
}): ClaudeRestartReason => {
  if (!input.sameSession) return "other";
  if (input.previousKey === input.nextKey) return "model";
  const changed = (field: string) =>
    keyField(input.previousKey, field) !== keyField(input.nextKey, field);
  return changed("workspace")
    ? "workspace"
    : changed("mcpServers")
      ? "mcp"
      : changed("runtimePolicy")
        ? "permissions"
        : "other";
};

export const claudeRestartBlockingItems = (input: {
  readonly roster: Iterable<OrchestrationV2PendingBackgroundTask>;
  readonly subagents: Iterable<{
    readonly taskId: string;
    readonly title: string | null;
    readonly prompt: string;
  }>;
}): ReadonlyArray<ClaudeRestartBlockingItem> => [
  ...Array.from(input.roster, (task) => ({
    taskId: task.taskId,
    kind: task.kind === "subagent" ? ("agent" as const) : ("command" as const),
    description: task.command ?? task.description ?? task.taskId,
  })),
  ...Array.from(input.subagents, (subagent) => ({
    taskId: subagent.taskId,
    kind: "agent" as const,
    description: subagent.title ?? subagent.prompt,
  })),
];
