import { type ForkMcpScopes, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ForkMcpScopeSection } from "./ForkMcpScopeSection";

const claudeId = ProviderInstanceId.make("claudeAgent");
const codexId = ProviderInstanceId.make("codex");

const providers = [
  { instanceId: claudeId, label: "Claude" },
  { instanceId: codexId, label: "Codex" },
];

describe("ForkMcpScopeSection", () => {
  it("switches presets, toggles groups, and reveals tool names", async () => {
    const onUpdateScopes = vi.fn();
    const scopes: ForkMcpScopes = {};

    // router: false because this section renders standalone without TanStack Router links.
    await using screen = await render(
      <ForkMcpScopeSection
        providers={providers}
        defaultInstanceId={claudeId}
        scopes={scopes}
        disabled={false}
        onUpdateScopes={onUpdateScopes}
      />,
      { router: false },
    );

    await expect.element(screen.getByText("Agent integration")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(onUpdateScopes).toHaveBeenCalledWith({
      [claudeId]: { preset: "standard" },
    });

    await userEvent.click(screen.getByRole("switch", { name: "Themes tools for Claude" }));
    expect(onUpdateScopes).toHaveBeenLastCalledWith({
      [claudeId]: {
        preset: "custom",
        groups: expect.objectContaining({ themes: false, preview: true }),
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Show tool names" }));
    await expect.element(screen.getByText(/t3_theme_read, t3_theme_set/)).toBeVisible();
  });

  it("shows reset button and off notice when a provider is set to Off", async () => {
    const onUpdateScopes = vi.fn();
    const scopes: ForkMcpScopes = { [codexId]: { preset: "off" } };

    // router: false because this section renders standalone without TanStack Router links.
    await using screen = await render(
      <ForkMcpScopeSection
        providers={providers}
        defaultInstanceId={codexId}
        scopes={scopes}
        disabled={false}
        onUpdateScopes={onUpdateScopes}
      />,
      { router: false },
    );

    await expect.element(screen.getByText(/T3 MCP is turned off for this provider/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reset Codex integration to Full" }));
    expect(onUpdateScopes).toHaveBeenCalledWith({ [codexId]: null });
  });
});
