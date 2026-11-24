import { FORK_TOOL_CALL_WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "~/connection/runtime";

export const forkMoveToolCallToBackground = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:move-tool-call-to-background",
  tag: FORK_TOOL_CALL_WS_METHODS.moveToBackground,
});

export const forkStopToolCall = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:stop-tool-call",
  tag: FORK_TOOL_CALL_WS_METHODS.stop,
});
