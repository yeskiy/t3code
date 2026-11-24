import { describe, expect, it } from "vite-plus/test";
import {
  FORK_MCP_CORE_TOOLS,
  FORK_MCP_PRESET_GROUPS,
  FORK_MCP_TOOL_GROUPS,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  buildForkMcpGroupTogglePatch,
  buildForkMcpPresetPatch,
  countEnabledForkMcpTools,
  describeForkMcpScopeMode,
} from "./mcpScope.logic";

describe("mcpScope.logic", () => {
  const claude = ProviderInstanceId.make("claudeAgent");

  it("builds patches for presets and resets Full to null", () => {
    expect(buildForkMcpPresetPatch(claude, "full")).toEqual({ [claude]: null });
    expect(buildForkMcpPresetPatch(claude, "standard")).toEqual({
      [claude]: { preset: "standard" },
    });
    expect(buildForkMcpPresetPatch(claude, "minimal")).toEqual({
      [claude]: { preset: "minimal" },
    });
    expect(buildForkMcpPresetPatch(claude, "off")).toEqual({
      [claude]: { preset: "off" },
    });
  });

  it("toggles individual groups and turns MCP back on when enabling a group from Off", () => {
    // Disabling one group from Full produces a custom scope.
    const fromFull = buildForkMcpGroupTogglePatch(claude, undefined, "themes", false);
    expect(fromFull[claude]?.preset).toBe("custom");
    expect(fromFull[claude]?.groups?.themes).toBe(false);
    expect(fromFull[claude]?.groups?.preview).toBe(true);

    // Re-enabling that group normalizes back to null (Full).
    const backToFull = buildForkMcpGroupTogglePatch(
      claude,
      fromFull[claude] ?? undefined,
      "themes",
      true,
    );
    expect(backToFull).toEqual({ [claude]: null });

    // Enabling one group while Off enables MCP in Custom mode with only that group.
    const fromOff = buildForkMcpGroupTogglePatch(claude, { preset: "off" }, "preview", true);
    expect(fromOff[claude]).toEqual({
      preset: "custom",
      groups: { ...FORK_MCP_PRESET_GROUPS.minimal, preview: true },
    });

    // Turning off the only enabled group normalizes to Minimal.
    const toMinimal = buildForkMcpGroupTogglePatch(
      claude,
      fromOff[claude] ?? undefined,
      "preview",
      false,
    );
    expect(toMinimal).toEqual({ [claude]: { preset: "minimal" } });
  });

  it("counts enabled tools accurately for every preset", () => {
    const allGroupTools = FORK_MCP_TOOL_GROUPS.reduce((sum, group) => sum + group.tools.length, 0);
    expect(countEnabledForkMcpTools(undefined)).toBe(allGroupTools + FORK_MCP_CORE_TOOLS.length);
    expect(countEnabledForkMcpTools({ preset: "minimal" })).toBe(FORK_MCP_CORE_TOOLS.length);
    expect(countEnabledForkMcpTools({ preset: "off" })).toBe(0);
    expect(describeForkMcpScopeMode("standard")).toContain("Standard");
  });
});
