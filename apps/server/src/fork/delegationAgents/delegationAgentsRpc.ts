import {
  FORK_DELEGATION_AGENTS_WS_METHODS,
  ForkDelegationAgentsRpcError,
  type ForkListDelegationAgentsInput,
  type ForkThreadDelegationAgent,
  type ForkThreadDelegationAgentInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ForkAgentError } from "./agentFile.ts";
import type { ForkDelegationAgents } from "./ForkDelegationAgents.ts";

const toRpcError = (error: ForkAgentError) =>
  new ForkDelegationAgentsRpcError({ detail: error.message });

/** Read-only RPC handlers that show which agent a delegated child runs as. */
export const forkDelegationAgentsRpcHandlers = (deps: {
  readonly agents: ForkDelegationAgents["Service"];
  readonly threadModel: (
    threadId: ThreadId,
  ) => Effect.Effect<{ readonly instanceId: string; readonly model: string } | undefined>;
  readonly providers: Effect.Effect<
    ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>
  >;
}) => ({
  [FORK_DELEGATION_AGENTS_WS_METHODS.list]: (input: ForkListDelegationAgentsInput) =>
    deps.agents
      .describe({ includeInstructions: input.includeInstructions === true })
      .pipe(Effect.mapError(toRpcError)),
  [FORK_DELEGATION_AGENTS_WS_METHODS.forThread]: Effect.fn("fork.delegationAgents.forThread")(
    function* (input: ForkThreadDelegationAgentInput) {
      const [agent] = yield* deps.agents
        .describe({
          includeInstructions: input.includeInstructions === true,
          threadId: input.threadId,
        })
        .pipe(Effect.mapError(toRpcError));
      if (agent === undefined) return null;
      const selection = yield* deps.threadModel(input.threadId);
      const driver =
        selection === undefined
          ? undefined
          : (yield* deps.providers).find((provider) => provider.instanceId === selection.instanceId)
              ?.driver;
      return {
        agent: {
          ...agent,
          defaults:
            driver === undefined
              ? agent.defaults
              : agent.defaults.filter((preset) => preset.driver === driver),
        },
        ...(driver === undefined ? {} : { driver }),
        ...(selection === undefined ? {} : { model: selection.model }),
      } satisfies ForkThreadDelegationAgent;
    },
  ),
});
