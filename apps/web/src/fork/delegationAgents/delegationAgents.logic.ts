import type {
  ForkAgentLimit,
  ForkAgentModelDefault,
  ForkThreadDelegationAgent,
} from "@t3tools/contracts";

const LIMIT_LABELS: Record<ForkAgentLimit, string> = {
  "read-only": "read-only",
  "no-delegation": "cannot delegate",
};

export const forkAgentLimitLabels = (limits: ReadonlyArray<ForkAgentLimit>): string[] =>
  limits.map((limit) => LIMIT_LABELS[limit]);

export const formatForkAgentTextSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

export const formatForkAgentDefault = (preset: ForkAgentModelDefault): string =>
  `${preset.driver}: ${[
    preset.model ?? "provider model",
    ...(preset.effort === undefined ? [] : [`effort ${preset.effort}`]),
  ].join(", ")}`;

export const formatForkAgentRun = (
  run: Pick<ForkThreadDelegationAgent, "driver" | "model">,
): string | null =>
  run.model === undefined
    ? null
    : run.driver === undefined
      ? run.model
      : `${run.model} (${run.driver})`;
