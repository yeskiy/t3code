import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

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
  roles: Schema.Array(Schema.String),
  limits: Schema.Array(ForkAgentLimit),
});
export type ForkAgentSummary = typeof ForkAgentSummary.Type;

export interface ForkTurnAgent {
  readonly name: string;
  readonly limits: ReadonlyArray<ForkAgentLimit>;
  readonly instructions: string;
}
