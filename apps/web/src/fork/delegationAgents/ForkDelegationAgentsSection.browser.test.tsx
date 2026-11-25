import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ForkDelegationAgentsList } from "./ForkDelegationAgentsSection";

describe("ForkDelegationAgentsList", () => {
  it("shows one row per agent with its limits, size, and problem", async () => {
    await using screen = await render(
      <ForkDelegationAgentsList
        state={{
          kind: "ready",
          agents: [
            {
              name: "researcher",
              description: "Read-only research.",
              roles: ["research"],
              limits: ["read-only", "no-delegation"],
              skills: ["ste-base"],
              defaults: [],
              instructionsBytes: 2048,
            },
            {
              name: "writer",
              description: "Personal prose.",
              roles: [],
              limits: [],
              skills: ["missing-skill"],
              defaults: [{ driver: "codex", model: "gpt-5" }],
              problem: "Skill missing-skill is not in C:/skills.",
            },
          ],
        }}
        renderInstructions={(name) => `text of ${name}`}
      />,
      { router: false },
    );

    await expect.element(screen.getByRole("heading", { name: "Delegation agents" })).toBeVisible();
    await expect.element(screen.getByText("researcher", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Read-only research.")).toBeVisible();
    await expect.element(screen.getByText("read-only, cannot delegate")).toBeVisible();
    await expect.element(screen.getByText("2.0 KB")).toBeVisible();
    await expect.element(screen.getByText("codex: gpt-5")).toBeVisible();
    await expect
      .element(screen.getByText("Skill missing-skill is not in C:/skills."))
      .toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Show instructions" }).first());
    await expect.element(screen.getByText("text of researcher")).toBeVisible();
  });

  it("explains an empty agents folder", async () => {
    await using screen = await render(
      <ForkDelegationAgentsList
        state={{ kind: "ready", agents: [] }}
        renderInstructions={() => ""}
      />,
      { router: false },
    );
    await expect.element(screen.getByText("No agents are defined.")).toBeVisible();
  });
});
