import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";

export const NATIVE_SUBAGENT_BULLET_PREFIX = "- Subagents: use your native tool";

export const FORK_DELEGATE_ONLY_BULLET =
  '- Subagents: your native `Agent` tool is off. Use `delegate_task` for every subagent, in the foreground or the background. Set `agent` to a name from `orchestrator_capabilities` when one fits. Use `mode:"wait"` only when this turn needs the result. Workflow only when asked.';

export const forkOrchestrationInstructions = (nativeAgentOff: boolean): string =>
  nativeAgentOff
    ? T3_CODE_ORCHESTRATION_INSTRUCTIONS.split("\n")
        .map((line) =>
          line.startsWith(NATIVE_SUBAGENT_BULLET_PREFIX) ? FORK_DELEGATE_ONLY_BULLET : line,
        )
        .join("\n")
    : T3_CODE_ORCHESTRATION_INSTRUCTIONS;
