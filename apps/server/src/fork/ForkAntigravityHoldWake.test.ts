import { assert, describe, it } from "@effect/vitest";
import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";

import { buildAntigravityHoldWakePrompt } from "./ForkAntigravityHoldWake.ts";

const makeCommand = (
  toolCallId: string,
  title?: string,
  extra?: { readonly detail?: string; readonly command?: string },
): AcpToolCallState => ({
  toolCallId,
  kind: "execute",
  status: "inProgress",
  ...(title === undefined ? {} : { title }),
  ...(extra?.detail === undefined ? {} : { detail: extra.detail }),
  ...(extra?.command === undefined ? {} : { command: extra.command }),
  data: {},
});

describe("buildAntigravityHoldWakePrompt", () => {
  it("uses the plain wake prompt when no command title is available", () => {
    assert.equal(
      buildAntigravityHoldWakePrompt([makeCommand("call_1")]),
      "A background command you started has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.",
    );
    assert.equal(
      buildAntigravityHoldWakePrompt([makeCommand("call_1", "   ")]),
      "A background command you started has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.",
    );
    assert.equal(
      buildAntigravityHoldWakePrompt([makeCommand("call_1", "Ran command")]),
      "A background command you started has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.",
    );
  });

  it("includes the command title or detail when the presentation title is generic", () => {
    assert.equal(
      buildAntigravityHoldWakePrompt([makeCommand("call_1", "node fetch_throughput.mjs")]),
      "A background command you started (node fetch_throughput.mjs) has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.",
    );
    assert.equal(
      buildAntigravityHoldWakePrompt([
        makeCommand("call_1", "Ran command", {
          detail: "node fetch_throughput.mjs",
          command: "node fetch_throughput.mjs",
        }),
      ]),
      "A background command you started (node fetch_throughput.mjs) has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.",
    );
  });

  it("deduplicates titles, normalizes whitespace, and bounds long titles", () => {
    const longTitle = "x".repeat(200);
    const prompt = buildAntigravityHoldWakePrompt([
      makeCommand("call_1", "  Run\nunit   tests  "),
      makeCommand("call_2", "Run unit tests"),
      makeCommand("call_3", longTitle),
    ]);
    assert.equal(
      prompt,
      `A background command you started (Run unit tests, ${"x".repeat(157)}...) has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.`,
    );
  });
});
