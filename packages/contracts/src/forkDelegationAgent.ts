import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const FORK_AGENT_LIMITS = ["read-only", "no-delegation"] as const;
export const ForkAgentLimit = Schema.Literals(FORK_AGENT_LIMITS);
export type ForkAgentLimit = typeof ForkAgentLimit.Type;

export const ForkAgentName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,39}$/),
);
export type ForkAgentName = typeof ForkAgentName.Type;

export const ForkDelegateTaskAgentField = Schema.optional(ForkAgentName).annotate({
  description:
    "Name of a T3 agent from orchestrator_capabilities. Its instructions, limits, and model defaults apply to the child.",
});

export const ForkAgentSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  provider: Schema.optional(Schema.String),
  roles: Schema.Array(Schema.String),
  limits: Schema.Array(ForkAgentLimit),
});
export type ForkAgentSummary = typeof ForkAgentSummary.Type;

export interface ForkTurnAgent {
  readonly name: string;
  readonly limits: ReadonlyArray<ForkAgentLimit>;
  readonly instructions: string;
}

export const FORK_DELEGATION_AGENTS_WS_METHODS = {
  list: "fork.delegationAgents.list",
  forThread: "fork.delegationAgents.forThread",
} as const;

export const ForkAgentModelDefault = Schema.Struct({
  driver: Schema.String,
  model: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.String),
});
export type ForkAgentModelDefault = typeof ForkAgentModelDefault.Type;

export const ForkAgentDetail = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  provider: Schema.optional(Schema.String),
  roles: Schema.Array(Schema.String),
  limits: Schema.Array(ForkAgentLimit),
  skills: Schema.Array(Schema.String),
  defaults: Schema.Array(ForkAgentModelDefault),
  /** Byte size of the rendered agent text. Absent when the text cannot be built. */
  instructionsBytes: Schema.optional(Schema.Number),
  problem: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
});
export type ForkAgentDetail = typeof ForkAgentDetail.Type;

export const ForkListDelegationAgentsInput = Schema.Struct({
  includeInstructions: Schema.optional(Schema.Boolean),
});
export type ForkListDelegationAgentsInput = typeof ForkListDelegationAgentsInput.Type;

export const ForkThreadDelegationAgentInput = Schema.Struct({
  threadId: ThreadId,
  includeInstructions: Schema.optional(Schema.Boolean),
});
export type ForkThreadDelegationAgentInput = typeof ForkThreadDelegationAgentInput.Type;

export const ForkThreadDelegationAgent = Schema.Struct({
  agent: ForkAgentDetail,
  /** The driver and model the child thread runs with now. */
  driver: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
});
export type ForkThreadDelegationAgent = typeof ForkThreadDelegationAgent.Type;

export class ForkDelegationAgentsRpcError extends Schema.TaggedError<ForkDelegationAgentsRpcError>()(
  "ForkDelegationAgentsRpcError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export const WsForkListDelegationAgentsRpc = Rpc.make(FORK_DELEGATION_AGENTS_WS_METHODS.list, {
  payload: ForkListDelegationAgentsInput,
  success: Schema.Array(ForkAgentDetail),
  error: Schema.Union([ForkDelegationAgentsRpcError, EnvironmentAuthorizationError]),
});

export const WsForkThreadDelegationAgentRpc = Rpc.make(
  FORK_DELEGATION_AGENTS_WS_METHODS.forThread,
  {
    payload: ForkThreadDelegationAgentInput,
    success: Schema.NullOr(ForkThreadDelegationAgent),
    error: Schema.Union([ForkDelegationAgentsRpcError, EnvironmentAuthorizationError]),
  },
);
