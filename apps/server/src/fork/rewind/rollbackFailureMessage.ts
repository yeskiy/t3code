import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { SHARED_WORKSPACE_RESTORE_MESSAGE } from "../../orchestration-v2/CheckpointRestoreSafety.ts";
import {
  type CheckpointRollbackExecutionError,
  ROLLBACK_FAILED_MESSAGE,
  rollbackFailureClientMessage,
} from "../../orchestration-v2/CheckpointRollbackService.ts";
import { CheckpointRestoreError } from "../../orchestration-v2/CheckpointService.ts";

const isCheckpointRestoreError = Schema.is(CheckpointRestoreError);
const isProviderAdapterRollbackThreadError = Schema.is(
  ProviderAdapter.ProviderAdapterRollbackThreadError,
);

const MAX_PROVIDER_REASON_CHARS = 200;

const causeTextOf = (cause: unknown): string => {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

const tagOf = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tag = (cause as { readonly _tag?: unknown })._tag;
    if (typeof tag === "string" && tag.length > 0) return tag;
  }
  return "unknown";
};

// Map known rollback failures to specific user messages while keeping raw Git output generic.
export const forkRollbackFailureClientMessage = (
  error: CheckpointRollbackExecutionError,
): string => {
  const upstream = rollbackFailureClientMessage(error);
  if (upstream !== ROLLBACK_FAILED_MESSAGE) return upstream;
  if (isCheckpointRestoreError(error.cause)) return ROLLBACK_FAILED_MESSAGE;

  switch (error.reason) {
    case "rollback-target-invalid":
      return "The rewind point of this message is incomplete. Edit from an earlier message.";
    case "active-provider-changed":
      return "The thread uses another provider after this point. T3 cannot rewind to it.";
    case "provider-turn-unavailable":
      return "The provider turn of this point is missing. T3 cannot rewind to it.";
    case "shared-workspace":
      return SHARED_WORKSPACE_RESTORE_MESSAGE;
    case "unexpected-failure": {
      if (isProviderAdapterRollbackThreadError(error.cause)) {
        const text = causeTextOf(error.cause.cause);
        if (text.includes("no SDK assistant message cursor")) {
          return "This turn ended before Claude wrote a reply, and no earlier turn has a resume point. T3 cannot rewind to it.";
        }
        const firstLine = (text.split(/\r?\n/u)[0] ?? "")
          .trim()
          .slice(0, MAX_PROVIDER_REASON_CHARS);
        return `Claude could not rewind the session: ${firstLine}`;
      }
      return `${ROLLBACK_FAILED_MESSAGE} Reason: ${tagOf(error.cause)}`;
    }
  }
};

// Defaults to the upstream mapper so upstream runtime tests keep the generic message.
export class ForkRollbackFailureClientMessage extends Context.Reference<
  (error: CheckpointRollbackExecutionError) => string
>("t3/fork/rewind/ForkRollbackFailureClientMessage", {
  defaultValue: () => rollbackFailureClientMessage,
}) {}

export const layerForkRollbackFailureClientMessage = Layer.succeed(
  ForkRollbackFailureClientMessage,
  forkRollbackFailureClientMessage,
);
