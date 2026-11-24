import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  FORK_MCP_CORE_TOOLS,
  FORK_MCP_PRESET_GROUPS,
  FORK_MCP_TOOL_GROUPS,
  FORK_MCP_TOOL_TO_GROUP,
  ForkMcpProviderScope,
  forkMcpProviderScopeForPreset,
  isForkMcpToolAllowed,
  normalizeForkMcpProviderScope,
  resolveForkMcpProviderScope,
} from "./forkMcpScope.ts";

const decodeForkMcpProviderScope = Schema.decodeUnknownSync(ForkMcpProviderScope);

describe("forkMcpScope", () => {
  it("assigns every catalog tool to one unique group outside core tools", () => {
    const seen = new Set<string>(FORK_MCP_CORE_TOOLS);
    for (const group of FORK_MCP_TOOL_GROUPS) {
      expect(group.tools.length).toBeGreaterThan(0);
      for (const tool of group.tools) {
        expect(seen.has(tool)).toBe(false);
        seen.add(tool);
        expect(FORK_MCP_TOOL_TO_GROUP.get(tool)).toBe(group.id);
      }
    }
  });

  it("defaults undefined scope to Full with every group and uncategorized tools allowed", () => {
    const resolved = resolveForkMcpProviderScope(undefined);
    expect(resolved.enabled).toBe(true);
    expect(resolved.mode).toBe("full");
    expect(isForkMcpToolAllowed(resolved, "send_to_user")).toBe(true);
    expect(isForkMcpToolAllowed(resolved, "delegate_task")).toBe(true);
    expect(isForkMcpToolAllowed(resolved, "future_unknown_tool")).toBe(true);
  });

  it("enforces Standard, Minimal, and Off presets strictly", () => {
    const standard = resolveForkMcpProviderScope({ preset: "standard" });
    expect(standard.enabled).toBe(true);
    expect(standard.mode).toBe("standard");
    expect(isForkMcpToolAllowed(standard, "preview_open")).toBe(true);
    expect(isForkMcpToolAllowed(standard, "html_render")).toBe(true);
    expect(isForkMcpToolAllowed(standard, "request_secret")).toBe(true);
    expect(isForkMcpToolAllowed(standard, "send_to_user")).toBe(true);
    expect(isForkMcpToolAllowed(standard, "delegate_task")).toBe(false);
    expect(isForkMcpToolAllowed(standard, "t3_workflow")).toBe(false);
    expect(isForkMcpToolAllowed(standard, "t3_feedback")).toBe(false);
    expect(isForkMcpToolAllowed(standard, "t3_thread_send")).toBe(false);
    expect(isForkMcpToolAllowed(standard, "t3_project_delete")).toBe(false);
    expect(isForkMcpToolAllowed(standard, "t3_theme_set")).toBe(false);
    expect(isForkMcpToolAllowed(standard, "future_unknown_tool")).toBe(false);

    const minimal = resolveForkMcpProviderScope({ preset: "minimal" });
    expect(minimal.enabled).toBe(true);
    expect(minimal.mode).toBe("minimal");
    expect(isForkMcpToolAllowed(minimal, "send_to_user")).toBe(true);
    expect(isForkMcpToolAllowed(minimal, "t3_submit_output")).toBe(true);
    expect(isForkMcpToolAllowed(minimal, "tool_search")).toBe(true);
    expect(isForkMcpToolAllowed(minimal, "preview_open")).toBe(false);
    expect(isForkMcpToolAllowed(minimal, "request_secret")).toBe(false);

    const off = resolveForkMcpProviderScope({ preset: "off" });
    expect(off.enabled).toBe(false);
    expect(off.mode).toBe("off");
    expect(isForkMcpToolAllowed(off, "send_to_user")).toBe(false);
    expect(isForkMcpToolAllowed(off, "t3_submit_output")).toBe(false);
    expect(isForkMcpToolAllowed(off, "tool_search")).toBe(false);
    expect(isForkMcpToolAllowed(off, "preview_open")).toBe(false);
  });

  it("normalizes custom switches back to presets or null for Full", () => {
    expect(forkMcpProviderScopeForPreset("full")).toBeNull();
    expect(forkMcpProviderScopeForPreset("off")).toEqual({ preset: "off" });

    expect(normalizeForkMcpProviderScope(true, FORK_MCP_PRESET_GROUPS.full)).toBeNull();
    expect(normalizeForkMcpProviderScope(true, FORK_MCP_PRESET_GROUPS.standard)).toEqual({
      preset: "standard",
    });
    expect(normalizeForkMcpProviderScope(true, FORK_MCP_PRESET_GROUPS.minimal)).toEqual({
      preset: "minimal",
    });
    expect(normalizeForkMcpProviderScope(false, FORK_MCP_PRESET_GROUPS.full)).toEqual({
      preset: "off",
    });

    const custom = normalizeForkMcpProviderScope(true, {
      ...FORK_MCP_PRESET_GROUPS.minimal,
      preview: true,
    });
    expect(custom).not.toBeNull();
    expect(custom?.preset).toBe("custom");
    const decoded = decodeForkMcpProviderScope(custom);
    const resolved = resolveForkMcpProviderScope(decoded);
    expect(resolved.mode).toBe("custom");
    expect(isForkMcpToolAllowed(resolved, "preview_status")).toBe(true);
    expect(isForkMcpToolAllowed(resolved, "html_render")).toBe(false);
    expect(isForkMcpToolAllowed(resolved, "t3_submit_output")).toBe(true);
  });
});
