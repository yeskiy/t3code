import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { ThreadId, TurnItemId } from "./baseSchemas.ts";

export const FORK_TOOL_CALL_WS_METHODS = {
  moveToBackground: "fork.toolCall.moveToBackground",
  stop: "fork.toolCall.stop",
} as const;

export const ForkMoveToolCallToBackgroundInput = Schema.Struct({
  threadId: ThreadId,
  itemId: TurnItemId,
});
export type ForkMoveToolCallToBackgroundInput = typeof ForkMoveToolCallToBackgroundInput.Type;

export const ForkStopToolCallInput = Schema.Struct({
  threadId: ThreadId,
  itemId: TurnItemId,
});
export type ForkStopToolCallInput = typeof ForkStopToolCallInput.Type;

export class ForkToolCallControlError extends Schema.TaggedError<ForkToolCallControlError>()(
  "ForkToolCallControlError",
  {
    threadId: ThreadId,
    itemId: TurnItemId,
    reason: Schema.Literals([
      "not-running",
      "unsupported",
      "unavailable",
      "move-failed",
      "stop-failed",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "stop-failed"
      ? `Could not stop tool call ${this.itemId} (${this.reason}).`
      : `Could not move tool call ${this.itemId} to the background (${this.reason}).`;
  }
}

export const WsForkMoveToolCallToBackgroundRpc = Rpc.make(
  FORK_TOOL_CALL_WS_METHODS.moveToBackground,
  {
    payload: ForkMoveToolCallToBackgroundInput,
    success: Schema.Void,
    error: Schema.Union([ForkToolCallControlError, EnvironmentAuthorizationError]),
  },
);

export const WsForkStopToolCallRpc = Rpc.make(FORK_TOOL_CALL_WS_METHODS.stop, {
  payload: ForkStopToolCallInput,
  success: Schema.Void,
  error: Schema.Union([ForkToolCallControlError, EnvironmentAuthorizationError]),
});
