import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { AcpToolCallState } from "../runtimeModel.ts";
import { handlePostSettleCommandHoldExpiry } from "./postSettleWake.ts";

const makeCommand = (toolCallId: string, title?: string): AcpToolCallState => ({
  toolCallId,
  kind: "execute",
  status: "inProgress",
  ...(title === undefined ? {} : { title }),
  data: {},
});

describe("handlePostSettleCommandHoldExpiry", () => {
  it.effect("finalizes directly when wakePrompt is not configured", () =>
    Effect.gen(function* () {
      const state = { postSettleHoldWoken: false };
      const sent: Array<string> = [];
      const finalized: Array<string> = [];

      const outcome = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [makeCommand("call_1", "vp test")],
        wakePrompt: undefined,
        isStillEligible: () => true,
        canKeepWaiting: () => true,
        sendWakePrompt: (text) => Effect.sync(() => void sent.push(text)),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(outcome, "done");
      assert.isFalse(state.postSettleHoldWoken);
      assert.deepEqual(sent, []);
      assert.deepEqual(finalized, ["finalized"]);
    }),
  );

  it.effect("wakes once on the first expiry and finalizes on a second expiry", () =>
    Effect.gen(function* () {
      const state = { postSettleHoldWoken: false };
      const sent: Array<string> = [];
      const finalized: Array<string> = [];
      const command = makeCommand("call_1", "node test.mjs");
      const wakePrompt = (commands: ReadonlyArray<AcpToolCallState>) =>
        `Wake for ${commands.map((item) => item.title).join(", ")}`;

      const first = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [command],
        wakePrompt,
        isStillEligible: () => true,
        canKeepWaiting: () => true,
        sendWakePrompt: (text) =>
          Effect.sync(() => {
            state.postSettleHoldWoken = true;
            sent.push(text);
          }),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(first, "done");
      assert.isTrue(state.postSettleHoldWoken);
      assert.deepEqual(sent, ["Wake for node test.mjs"]);
      assert.deepEqual(finalized, []);

      const second = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [command],
        wakePrompt,
        isStillEligible: () => true,
        canKeepWaiting: () => true,
        sendWakePrompt: (text) => Effect.sync(() => void sent.push(text)),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(second, "done");
      assert.deepEqual(sent, ["Wake for node test.mjs"]);
      assert.deepEqual(finalized, ["finalized"]);
    }),
  );

  it.effect("falls back to finalize when wake dispatch fails and the hold still applies", () =>
    Effect.gen(function* () {
      const state = { postSettleHoldWoken: false };
      const finalized: Array<string> = [];

      const outcome = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [makeCommand("call_1", "vp test")],
        wakePrompt: () => "Wake now",
        isStillEligible: () => true,
        canKeepWaiting: () => true,
        sendWakePrompt: () => Effect.fail("transport closed"),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(outcome, "done");
      assert.deepEqual(finalized, ["finalized"]);
    }),
  );

  it.effect("stops without finalizing when a user steer or stop wins the race", () =>
    Effect.gen(function* () {
      const state = { postSettleHoldWoken: false };
      const finalized: Array<string> = [];

      const outcome = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [makeCommand("call_1", "vp test")],
        wakePrompt: () => "Wake now",
        isStillEligible: () => false,
        canKeepWaiting: () => false,
        sendWakePrompt: () => Effect.fail("not eligible"),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(outcome, "done");
      assert.isFalse(state.postSettleHoldWoken);
      assert.deepEqual(finalized, []);
    }),
  );

  it.effect("returns retry when another hold takes over before wake dispatch", () =>
    Effect.gen(function* () {
      const state = { postSettleHoldWoken: false };
      const finalized: Array<string> = [];

      const outcome = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [makeCommand("call_1", "vp test")],
        wakePrompt: () => "Wake now",
        isStillEligible: () => false,
        canKeepWaiting: () => true,
        sendWakePrompt: () => Effect.fail("question open"),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(outcome, "retry");
      assert.isFalse(state.postSettleHoldWoken);
      assert.deepEqual(finalized, []);
    }),
  );

  it.effect("finalizes directly when wakePrompt returns only whitespace", () =>
    Effect.gen(function* () {
      const state = { postSettleHoldWoken: false };
      const sent: Array<string> = [];
      const finalized: Array<string> = [];

      const outcome = yield* handlePostSettleCommandHoldExpiry({
        state,
        commands: [makeCommand("call_1")],
        wakePrompt: () => "   ",
        isStillEligible: () => true,
        canKeepWaiting: () => true,
        sendWakePrompt: (text) => Effect.sync(() => void sent.push(text)),
        finalize: Effect.sync(() => void finalized.push("finalized")),
      });

      assert.equal(outcome, "done");
      assert.deepEqual(sent, []);
      assert.deepEqual(finalized, ["finalized"]);
    }),
  );
});
