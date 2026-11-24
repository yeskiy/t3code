/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import {
  FORK_MCP_CORE_TOOLS,
  FORK_MCP_PRESET_GROUPS,
  FORK_MCP_SCOPE_PRESETS,
  FORK_MCP_TOOL_GROUPS,
  type ForkMcpProviderScope,
  type ForkMcpScopeMode,
  type ForkMcpScopePreset,
  type ForkMcpScopesPatch,
  type ForkMcpToolGroupId,
  type ProviderInstanceId,
  forkMcpProviderScopeForPreset,
  normalizeForkMcpProviderScope,
  resolveForkMcpProviderScope,
} from "@t3tools/contracts";

export interface ForkMcpPresetOption {
  readonly id: ForkMcpScopePreset;
  readonly label: string;
  readonly description: string;
}

export const FORK_MCP_PRESET_OPTIONS: ReadonlyArray<ForkMcpPresetOption> = [
  {
    id: "full",
    label: "Full",
    description: "All T3 MCP tool groups are available, subject to environment access settings.",
  },
  {
    id: "standard",
    label: "Standard",
    description:
      "Browser preview, HTML visuals, devices, worktrees, pull requests, issues, secrets, and core tools.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description:
      "Only core tools stay enabled so T3 Code can receive messages and structured output.",
  },
  {
    id: "off",
    label: "Off",
    description:
      "T3 Code does not attach its MCP server to this provider and blocks all tool calls.",
  },
];

export const FORK_MCP_MODE_LABELS: Readonly<Record<ForkMcpScopeMode, string>> = {
  full: "Full",
  standard: "Standard",
  minimal: "Minimal",
  off: "Off",
  custom: "Custom",
};

export function describeForkMcpScopeMode(mode: ForkMcpScopeMode): string {
  const preset = FORK_MCP_PRESET_OPTIONS.find((option) => option.id === mode);
  if (preset !== undefined) return `${preset.label}: ${preset.description}`;
  return "Custom: Only the selected tool groups and core tools are available.";
}

export function countEnabledForkMcpTools(stored: ForkMcpProviderScope | undefined): number {
  const resolved = resolveForkMcpProviderScope(stored);
  if (!resolved.enabled) return 0;
  let total = FORK_MCP_CORE_TOOLS.length;
  for (const group of FORK_MCP_TOOL_GROUPS) {
    if (resolved.groups[group.id]) total += group.tools.length;
  }
  return total;
}

export function buildForkMcpPresetPatch(
  instanceId: ProviderInstanceId,
  preset: ForkMcpScopePreset,
): ForkMcpScopesPatch {
  return { [instanceId]: forkMcpProviderScopeForPreset(preset) };
}

export function buildForkMcpGroupTogglePatch(
  instanceId: ProviderInstanceId,
  currentStored: ForkMcpProviderScope | undefined,
  groupId: ForkMcpToolGroupId,
  checked: boolean,
): ForkMcpScopesPatch {
  const current = resolveForkMcpProviderScope(currentStored);
  const baseGroups = current.enabled ? current.groups : FORK_MCP_PRESET_GROUPS.minimal;
  const nextGroups = { ...baseGroups, [groupId]: checked };
  const nextEnabled = current.enabled || checked;
  return { [instanceId]: normalizeForkMcpProviderScope(nextEnabled, nextGroups) };
}

export function isForkMcpScopePreset(value: string): value is ForkMcpScopePreset {
  return (FORK_MCP_SCOPE_PRESETS as ReadonlyArray<string>).includes(value);
}
