import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { ThreadId, TurnItemId } from "./baseSchemas.ts";

export const FORK_TOOL_CALL_WS_METHODS = {
  moveToBackground: "fork.toolCall.moveToBackground",
} as const;

export const ForkMoveToolCallToBackgroundInput = Schema.Struct({
  threadId: ThreadId,
  itemId: TurnItemId,
});
export type ForkMoveToolCallToBackgroundInput = typeof ForkMoveToolCallToBackgroundInput.Type;

export class ForkToolCallControlError extends Schema.TaggedError<ForkToolCallControlError>()(
  "ForkToolCallControlError",
  {
    threadId: ThreadId,
    itemId: TurnItemId,
    reason: Schema.Literals(["not-running", "unsupported", "unavailable", "move-failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Could not move tool call ${this.itemId} to the background (${this.reason}).`;
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
