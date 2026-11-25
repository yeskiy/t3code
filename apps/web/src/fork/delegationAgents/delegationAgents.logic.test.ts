import { describe, expect, it } from "vite-plus/test";

import {
  formatForkAgentDefault,
  formatForkAgentRun,
  formatForkAgentTextSize,
  forkAgentLimitLabels,
} from "./delegationAgents.logic";

describe("forkAgentLimitLabels", () => {
  it("names each limit in plain words", () => {
    expect(forkAgentLimitLabels(["read-only", "no-delegation"])).toEqual([
      "read-only",
      "cannot delegate",
    ]);
    expect(forkAgentLimitLabels([])).toEqual([]);
  });
});

describe("formatForkAgentTextSize", () => {
  it("shows bytes under 1 KB and one decimal in KB above it", () => {
    expect(formatForkAgentTextSize(512)).toBe("512 B");
    expect(formatForkAgentTextSize(13_517)).toBe("13.2 KB");
    expect(formatForkAgentTextSize(1024)).toBe("1.0 KB");
  });
});

describe("formatForkAgentDefault", () => {
  it("joins the driver, the model, and the effort that are set", () => {
    expect(
      formatForkAgentDefault({ driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" }),
    ).toBe("claudeAgent: claude-opus-5-5, effort high");
    expect(formatForkAgentDefault({ driver: "codex", model: "gpt-5" })).toBe("codex: gpt-5");
    expect(formatForkAgentDefault({ driver: "codex", effort: "low" })).toBe(
      "codex: provider model, effort low",
    );
  });
});

describe("formatForkAgentRun", () => {
  it("names the model and driver the child runs with now", () => {
    expect(formatForkAgentRun({ driver: "claudeAgent", model: "claude-sonnet-5-5" })).toBe(
      "claude-sonnet-5-5 (claudeAgent)",
    );
    expect(formatForkAgentRun({ model: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
    expect(formatForkAgentRun({})).toBeNull();
  });
});
