import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";
import { describe, expect, it } from "@effect/vitest";
import {
  FORK_DELEGATE_ONLY_BULLET,
  NATIVE_SUBAGENT_BULLET_PREFIX,
  forkOrchestrationInstructions,
} from "./forkOrchestrationInstructions.ts";

describe("forkOrchestrationInstructions", () => {
  it("finds exactly one upstream native subagent bullet", () => {
    expect(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS.split("\n").filter((line) =>
        line.startsWith(NATIVE_SUBAGENT_BULLET_PREFIX),
      ),
    ).toHaveLength(1);
  });

  it("returns the upstream text when Agent is on", () => {
    expect(forkOrchestrationInstructions(false)).toBe(T3_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("swaps only that bullet when Agent is off", () => {
    const text = forkOrchestrationInstructions(true);
    expect(text).not.toContain("Claude `Agent`");
    expect(text).toContain(FORK_DELEGATE_ONLY_BULLET);
    expect(text.split("\n")).toHaveLength(T3_CODE_ORCHESTRATION_INSTRUCTIONS.split("\n").length);
  });
});
