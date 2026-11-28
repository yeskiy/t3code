import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "./providerInstance.ts";

/** Tools that stay available whenever the T3 MCP server is enabled for a provider. */
export const FORK_MCP_CORE_TOOLS = [
  "send_to_user",
  "t3_submit_output",
  "tool_call",
  "tool_search",
] as const;

export type ForkMcpCoreToolName = (typeof FORK_MCP_CORE_TOOLS)[number];

const FORK_MCP_CORE_TOOL_SET: ReadonlySet<string> = new Set(FORK_MCP_CORE_TOOLS);

const FORK_MCP_TOOL_GROUP_IDS = [
  "delegation",
  "threads",
  "projects",
  "worktrees",
  "preview",
  "html",
  "devices",
  "pullRequests",
  "issues",
  "secrets",
  "scheduledTasks",
  "environments",
  "themes",
] as const;

export const ForkMcpToolGroupId = Schema.Literals(FORK_MCP_TOOL_GROUP_IDS);
export type ForkMcpToolGroupId = typeof ForkMcpToolGroupId.Type;

export interface ForkMcpToolGroupDefinition {
  readonly id: ForkMcpToolGroupId;
  readonly label: string;
  readonly description: string;
  readonly tools: ReadonlyArray<string>;
}

export const FORK_MCP_TOOL_GROUPS: ReadonlyArray<ForkMcpToolGroupDefinition> = [
  {
    id: "delegation",
    label: "Delegation and background",
    description: "Start and manage child agents, workflows, and background tasks.",
    tools: [
      "orchestrator_capabilities",
      "delegate_task",
      "task_status",
      "task_cancel",
      "t3_workflow",
      "t3_workflow_stop",
      "t3_background_wait",
    ],
  },
  {
    id: "threads",
    label: "Threads and attachments",
    description: "List, read, start, message, queue, organize, and transfer T3 threads.",
    tools: [
      "create_threads",
      "t3_thread_launch",
      "t3_thread_list",
      "t3_thread_read",
      "t3_thread_update",
      "t3_thread_send",
      "t3_thread_wait",
      "t3_thread_interrupt",
      "t3_thread_organize",
      "t3_queue",
      "t3_pending_request",
      "t3_thread_configure",
      "t3_thread_transfer",
      "t3_thread_search",
      "t3_attachment_prepare_upload",
      "t3_attachment_discard",
      "t3_thread_send_attachments",
    ],
  },
  {
    id: "projects",
    label: "Projects",
    description: "List, read, create, update, clone, and delete registered projects.",
    tools: [
      "t3_project_list",
      "t3_project_read",
      "t3_project_create",
      "t3_project_update",
      "t3_project_delete",
      "t3_project_clone",
    ],
  },
  {
    id: "worktrees",
    label: "Worktrees",
    description: "Inspect branch worktrees and hand a thread off into a new worktree.",
    tools: ["t3_worktree_handoff", "t3_worktree_status", "t3_worktree_list"],
  },
  {
    id: "preview",
    label: "Browser preview",
    description: "Open, inspect, drive, and record tabs in the shared T3 preview browser.",
    tools: [
      "preview_status",
      "preview_open",
      "preview_dialog",
      "preview_navigate",
      "preview_resize",
      "preview_set_appearance",
      "preview_snapshot",
      "preview_act",
      "preview_evaluate",
      "preview_wait_for",
      "preview_recording_start",
      "preview_recording_stop",
      "t3_preview_list",
      "t3_preview_close",
    ],
  },
  {
    id: "html",
    label: "HTML visuals",
    description: "Preview and render inline charts, diagrams, and mockups in the thread.",
    tools: ["html_preview", "html_render"],
  },
  {
    id: "devices",
    label: "Devices",
    description: "List, open, screenshot, and close iOS Simulators and Android Emulators.",
    tools: ["device_list", "device_open", "device_screenshot", "device_close"],
  },
  {
    id: "pullRequests",
    label: "Pull requests and CI",
    description: "Read, create, review, merge, link, and watch pull requests and CI checks.",
    tools: [
      "link_pull_request",
      "link_pull_requests",
      "unlink_pull_request",
      "unlink_pull_requests",
      "list_thread_pull_requests",
      "watch_pull_request",
      "unwatch_pull_request",
      "write_pull_request_guides",
      "read_pull_request_guide",
      "pull_request_read",
      "pull_request_list",
      "pull_request_create",
      "pull_request_update",
      "pull_request_respond",
      "pull_request_review",
      "pull_request_merge",
      "ci_logs",
      "ci_rerun",
    ],
  },
  {
    id: "issues",
    label: "Issues",
    description: "List, read, file, comment on, update, and link tracked issues.",
    tools: [
      "list_issues",
      "read_issue",
      "create_issue",
      "comment_on_issue",
      "set_issue_state",
      "link_issue",
      "unlink_issue",
      "list_thread_issues",
    ],
  },
  {
    id: "secrets",
    label: "Secret requests",
    description: "Ask the user for a private token, password, or code in a secure card.",
    tools: ["request_secret"],
  },
  {
    id: "scheduledTasks",
    label: "Scheduled tasks",
    description: "Create, list, run, and delete scheduled recurring tasks.",
    tools: [
      "schedule_task",
      "list_scheduled_tasks",
      "delete_scheduled_task",
      "run_scheduled_task_now",
    ],
  },
  {
    id: "environments",
    label: "Environments",
    description: "Read and change environment settings, manage linked machines, and send feedback.",
    tools: [
      "t3_environment_read",
      "t3_environment_preferences_update",
      "t3_environment_links",
      "t3_environment_link",
      "t3_environment_unlink",
      "t3_feedback",
    ],
  },
  {
    id: "themes",
    label: "Themes",
    description: "Read and update T3 Code app themes and appearance.",
    tools: ["t3_theme_read", "t3_theme_set"],
  },
];

export const FORK_MCP_TOOL_TO_GROUP: ReadonlyMap<string, ForkMcpToolGroupId> = new Map(
  FORK_MCP_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => [tool, group.id] as const)),
);

export const FORK_MCP_SCOPE_PRESETS = ["full", "standard", "minimal", "off"] as const;
export const ForkMcpScopePreset = Schema.Literals(FORK_MCP_SCOPE_PRESETS);
export type ForkMcpScopePreset = typeof ForkMcpScopePreset.Type;

export const ForkMcpScopeMode = Schema.Literals([...FORK_MCP_SCOPE_PRESETS, "custom"] as const);
export type ForkMcpScopeMode = typeof ForkMcpScopeMode.Type;

export const ForkMcpGroupOverrides = Schema.Record(ForkMcpToolGroupId, Schema.Boolean);
export type ForkMcpGroupOverrides = typeof ForkMcpGroupOverrides.Type;

export const ForkMcpProviderScope = Schema.Struct({
  preset: ForkMcpScopeMode,
  groups: Schema.optionalKey(ForkMcpGroupOverrides),
});
export type ForkMcpProviderScope = typeof ForkMcpProviderScope.Type;

export const ForkMcpScopes = Schema.Record(ProviderInstanceId, ForkMcpProviderScope);
export type ForkMcpScopes = typeof ForkMcpScopes.Type;

export const ForkMcpScopesPatch = Schema.Record(
  ProviderInstanceId,
  Schema.NullOr(ForkMcpProviderScope),
);
export type ForkMcpScopesPatch = typeof ForkMcpScopesPatch.Type;

export type ForkMcpGroupStates = Readonly<Record<ForkMcpToolGroupId, boolean>>;

export interface ResolvedForkMcpScope {
  readonly enabled: boolean;
  readonly mode: ForkMcpScopeMode;
  readonly groups: ForkMcpGroupStates;
}

const STANDARD_ENABLED_GROUPS: ReadonlySet<ForkMcpToolGroupId> = new Set([
  "worktrees",
  "preview",
  "html",
  "devices",
  "pullRequests",
  "issues",
  "secrets",
]);

function makeGroupStates(predicate: (id: ForkMcpToolGroupId) => boolean): ForkMcpGroupStates {
  return Object.fromEntries(
    FORK_MCP_TOOL_GROUP_IDS.map((id) => [id, predicate(id)]),
  ) as ForkMcpGroupStates;
}

export const FORK_MCP_PRESET_GROUPS: Readonly<Record<ForkMcpScopePreset, ForkMcpGroupStates>> = {
  full: makeGroupStates(() => true),
  standard: makeGroupStates((id) => STANDARD_ENABLED_GROUPS.has(id)),
  minimal: makeGroupStates(() => false),
  off: makeGroupStates(() => false),
};

function matchesGroupStates(left: ForkMcpGroupStates, right: ForkMcpGroupStates): boolean {
  return FORK_MCP_TOOL_GROUP_IDS.every((id) => left[id] === right[id]);
}

function detectForkMcpScopeMode(enabled: boolean, groups: ForkMcpGroupStates): ForkMcpScopeMode {
  if (!enabled) return "off";
  if (matchesGroupStates(groups, FORK_MCP_PRESET_GROUPS.full)) return "full";
  if (matchesGroupStates(groups, FORK_MCP_PRESET_GROUPS.standard)) return "standard";
  if (matchesGroupStates(groups, FORK_MCP_PRESET_GROUPS.minimal)) return "minimal";
  return "custom";
}

export function resolveForkMcpProviderScope(
  stored: ForkMcpProviderScope | undefined,
): ResolvedForkMcpScope {
  if (stored === undefined) {
    return { enabled: true, mode: "full", groups: FORK_MCP_PRESET_GROUPS.full };
  }
  if (stored.preset === "off") {
    return { enabled: false, mode: "off", groups: FORK_MCP_PRESET_GROUPS.off };
  }
  const base =
    stored.preset === "custom"
      ? FORK_MCP_PRESET_GROUPS.minimal
      : FORK_MCP_PRESET_GROUPS[stored.preset];
  const groups = makeGroupStates((id) => stored.groups?.[id] ?? base[id]);
  return {
    enabled: true,
    mode: detectForkMcpScopeMode(true, groups),
    groups,
  };
}

/** Returns null when the scope matches the default Full preset so settings.json stays sparse. */
export function normalizeForkMcpProviderScope(
  enabled: boolean,
  groups: ForkMcpGroupStates,
): ForkMcpProviderScope | null {
  const mode = detectForkMcpScopeMode(enabled, groups);
  if (mode === "full") return null;
  if (mode === "off" || mode === "standard" || mode === "minimal") {
    return { preset: mode };
  }
  return { preset: "custom", groups: makeGroupStates((id) => groups[id]) };
}

export function forkMcpProviderScopeForPreset(
  preset: ForkMcpScopePreset,
): ForkMcpProviderScope | null {
  return preset === "full" ? null : { preset };
}

export function isForkMcpToolAllowed(scope: ResolvedForkMcpScope, toolName: string): boolean {
  if (!scope.enabled) return false;
  if (FORK_MCP_CORE_TOOL_SET.has(toolName)) return true;
  const groupId = FORK_MCP_TOOL_TO_GROUP.get(toolName);
  if (groupId !== undefined) return scope.groups[groupId] === true;
  // Uncategorized tools stay allowed only under Full; restricted scopes fail closed.
  return scope.mode === "full";
}
