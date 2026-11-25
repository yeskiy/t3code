import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ForkAgentBadgeView } from "./ForkAgentBadge";

describe("ForkAgentBadgeView", () => {
  it("shows the agent name and opens its details with the text on demand", async () => {
    await using screen = await render(
      <ForkAgentBadgeView
        thread={{
          agent: {
            name: "worker",
            description: "Implementation worker.",
            provider: "claudeAgent",
            roles: ["implementation"],
            limits: ["read-only", "no-delegation"],
            skills: ["ste-base", "superpowers-worker"],
            defaults: [{ driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" }],
            instructionsBytes: 13_517,
          },
          driver: "claudeAgent",
          model: "claude-sonnet-5-5",
        }}
        renderInstructions={() => "## T3 agent: worker"}
      />,
      { router: false },
    );

    const badge = screen.getByRole("button", { name: "Agent: worker" });
    await expect.element(badge).toHaveTextContent("worker");
    await userEvent.click(badge);

    await expect.element(screen.getByText("Implementation worker.")).toBeVisible();
    await expect.element(screen.getByText("read-only, cannot delegate")).toBeVisible();
    await expect.element(screen.getByText("claude-sonnet-5-5 (claudeAgent)")).toBeVisible();
    await expect
      .element(screen.getByText("claudeAgent: claude-opus-5-5, effort high"))
      .toBeVisible();
    await expect.element(screen.getByText("ste-base, superpowers-worker")).toBeVisible();
    await expect.element(screen.getByText("13.2 KB")).toBeVisible();
    expect(screen.getByText("## T3 agent: worker").query()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show instructions" }));
    await expect.element(screen.getByText("## T3 agent: worker")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Hide instructions" }));
    expect(screen.getByText("## T3 agent: worker").query()).toBeNull();
  });
});
