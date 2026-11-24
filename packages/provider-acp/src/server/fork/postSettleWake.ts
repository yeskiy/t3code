// fork: wake an ACP agent once on post-settle command hold expiry before finalizing.
import * as Effect from "effect/Effect";

import type { AcpToolCallState } from "../runtimeModel.ts";

interface PostSettleHoldWakeState {
  postSettleHoldWoken: boolean;
}

interface PostSettleHoldWakeInput<E> {
  readonly state: PostSettleHoldWakeState;
  readonly commands: ReadonlyArray<AcpToolCallState>;
  readonly wakePrompt: ((commands: ReadonlyArray<AcpToolCallState>) => string) | undefined;
  readonly isStillEligible: () => boolean;
  readonly canKeepWaiting: () => boolean;
  readonly sendWakePrompt: (text: string) => Effect.Effect<void, E>;
  readonly finalize: Effect.Effect<void>;
}

export const handlePostSettleCommandHoldExpiry = Effect.fn(
  "AcpAdapterV2.handlePostSettleCommandHoldExpiry",
)(function* <E>(input: PostSettleHoldWakeInput<E>): Effect.fn.Return<"done" | "retry"> {
  if (input.wakePrompt === undefined || input.state.postSettleHoldWoken) {
    yield* input.finalize;
    return "done";
  }
  const text = input.wakePrompt(input.commands).trim();
  if (text.length === 0) {
    yield* input.finalize;
    return "done";
  }
  const outcome = yield* input.sendWakePrompt(text).pipe(
    Effect.as("sent" as const),
    Effect.catchCause(() => Effect.succeed("failed" as const)),
  );
  if (outcome === "sent") {
    return "done";
  }
  if (input.isStillEligible()) {
    yield* input.finalize;
    return "done";
  }
  return input.canKeepWaiting() ? "retry" : "done";
});
