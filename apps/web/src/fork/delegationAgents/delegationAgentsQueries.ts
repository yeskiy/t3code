import { FORK_DELEGATION_AGENTS_WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "~/connection/runtime";

export const forkDelegationAgentsList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:fork:delegation-agents:list",
  tag: FORK_DELEGATION_AGENTS_WS_METHODS.list,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const forkThreadDelegationAgent = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "environment-data:fork:delegation-agents:for-thread",
    tag: FORK_DELEGATION_AGENTS_WS_METHODS.forThread,
    staleTimeMs: 60_000,
    idleTtlMs: 5 * 60_000,
  },
);
