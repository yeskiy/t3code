/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { useState } from "react";
import {
  FORK_MCP_CORE_TOOLS,
  FORK_MCP_TOOL_GROUPS,
  type ForkMcpScopes,
  type ForkMcpScopesPatch,
  type ProviderInstanceId,
  resolveForkMcpProviderScope,
} from "@t3tools/contracts";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import {
  FORK_MCP_MODE_LABELS,
  FORK_MCP_PRESET_OPTIONS,
  buildForkMcpGroupTogglePatch,
  buildForkMcpPresetPatch,
  countEnabledForkMcpTools,
  describeForkMcpScopeMode,
  isForkMcpScopePreset,
} from "./mcpScope.logic";

export interface ForkMcpScopeProviderItem {
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
}

export interface ForkMcpScopeSectionProps {
  readonly providers: ReadonlyArray<ForkMcpScopeProviderItem>;
  readonly defaultInstanceId?: ProviderInstanceId | undefined;
  readonly scopes: ForkMcpScopes;
  readonly disabled: boolean;
  readonly onUpdateScopes: (patch: ForkMcpScopesPatch) => void;
}

export function ForkMcpScopeSection({
  providers,
  defaultInstanceId,
  scopes,
  disabled,
  onUpdateScopes,
}: ForkMcpScopeSectionProps) {
  const [selectedId, setSelectedId] = useState<ProviderInstanceId | null>(null);
  const [showToolNames, setShowToolNames] = useState(false);

  if (providers.length === 0) return null;

  const activeProvider =
    providers.find((provider) => provider.instanceId === selectedId) ??
    providers.find((provider) => provider.instanceId === defaultInstanceId) ??
    providers[0]!;
  const stored = scopes[activeProvider.instanceId];
  const resolved = resolveForkMcpProviderScope(stored);
  const enabledToolCount = countEnabledForkMcpTools(stored);

  return (
    <SettingsSection id="fork-agent-integration" title="Agent integration">
      <SettingsRow
        title="Provider"
        description="Choose how much of the T3 Code MCP server this provider receives. Disabled tools are hidden and rejected on the server."
        resetAction={
          resolved.mode !== "full" && !disabled ? (
            <SettingResetButton
              ariaLabel={`Reset ${activeProvider.label} integration to Full`}
              onClick={() =>
                onUpdateScopes(buildForkMcpPresetPatch(activeProvider.instanceId, "full"))
              }
            />
          ) : null
        }
        control={
          <div className="w-full sm:w-56">
            <Select
              value={activeProvider.instanceId}
              onValueChange={(next) => {
                if (typeof next !== "string") return;
                const match = providers.find((provider) => provider.instanceId === next);
                if (match) setSelectedId(match.instanceId);
              }}
            >
              <SelectTrigger size="sm" aria-label="Provider for agent integration">
                <SelectValue>
                  {`${activeProvider.label} (${FORK_MCP_MODE_LABELS[resolved.mode]})`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {providers.map((provider) => {
                  const providerMode = resolveForkMcpProviderScope(
                    scopes[provider.instanceId],
                  ).mode;
                  return (
                    <SelectItem hideIndicator key={provider.instanceId} value={provider.instanceId}>
                      {`${provider.label} (${FORK_MCP_MODE_LABELS[providerMode]})`}
                    </SelectItem>
                  );
                })}
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title={
          <span className="inline-flex items-center gap-2">
            <span>Integration preset</span>
            <Badge variant={resolved.mode === "off" ? "warning" : "secondary"} size="sm">
              {`${FORK_MCP_MODE_LABELS[resolved.mode]} (${enabledToolCount} tools)`}
            </Badge>
          </span>
        }
        description={describeForkMcpScopeMode(resolved.mode)}
        control={
          <div inert={disabled} aria-disabled={disabled || undefined}>
            <ToggleGroup
              aria-label="Integration preset"
              value={resolved.mode === "custom" ? [] : [resolved.mode]}
              onValueChange={(values) => {
                const next = values[0];
                if (typeof next === "string" && isForkMcpScopePreset(next)) {
                  onUpdateScopes(buildForkMcpPresetPatch(activeProvider.instanceId, next));
                }
              }}
            >
              {FORK_MCP_PRESET_OPTIONS.map((option) => (
                <Toggle key={option.id} value={option.id} disabled={disabled}>
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
        }
      />

      <SettingsRow
        title={
          <span className="inline-flex items-center gap-2">
            <span>Core tools</span>
            <Badge variant="outline" size="sm">
              {resolved.enabled ? `${FORK_MCP_CORE_TOOLS.length} always on` : "Off"}
            </Badge>
          </span>
        }
        description={
          resolved.enabled
            ? `Always active while MCP is enabled: ${FORK_MCP_CORE_TOOLS.join(", ")}. Switch to Off to remove the T3 MCP server completely.`
            : "T3 MCP is turned off for this provider. New sessions start without the T3 MCP server, and live calls are rejected."
        }
        control={
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setShowToolNames((current) => !current)}
          >
            {showToolNames ? "Hide tool names" : "Show tool names"}
          </button>
        }
      />

      {FORK_MCP_TOOL_GROUPS.map((group) => {
        const checked = resolved.enabled && resolved.groups[group.id];
        return (
          <SettingsRow
            key={group.id}
            title={
              <span className="inline-flex items-center gap-2">
                <span>{group.label}</span>
                <Badge variant="outline" size="sm">
                  {String(group.tools.length)}
                </Badge>
              </span>
            }
            description={
              <span className="block space-y-1">
                <span className="block">{group.description}</span>
                {showToolNames ? (
                  <span className="block font-mono text-2xs text-muted-foreground/80">
                    {group.tools.join(", ")}
                  </span>
                ) : null}
              </span>
            }
            control={
              <Switch
                checked={checked}
                disabled={disabled}
                aria-label={`${group.label} tools for ${activeProvider.label}`}
                onCheckedChange={(nextChecked) => {
                  onUpdateScopes(
                    buildForkMcpGroupTogglePatch(
                      activeProvider.instanceId,
                      stored,
                      group.id,
                      Boolean(nextChecked),
                    ),
                  );
                }}
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}
