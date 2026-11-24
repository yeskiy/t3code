import type { ProviderInstanceId, ServerSettings } from "@t3tools/contracts";

const MILLIS_PER_MINUTE = 60_000;

export function readInstanceIdleTimeoutMinutes(
  settings: Pick<ServerSettings, "providerInstances">,
  instanceId: ProviderInstanceId,
): number | undefined {
  if (!Object.hasOwn(settings.providerInstances, instanceId)) return undefined;
  return settings.providerInstances[instanceId]?.idleTimeoutMinutes;
}

export function resolveInstanceIdleTimeoutMs(input: {
  readonly optionsIdleTimeoutMs?: number | undefined;
  readonly instanceIdleTimeoutMinutes?: number | undefined;
  readonly supportsNativeResume: boolean;
  readonly defaultIdleTimeoutMs: number;
  readonly noNativeResumeIdleTimeoutMs: number;
}): number {
  const configuredMs =
    input.instanceIdleTimeoutMinutes !== undefined
      ? input.instanceIdleTimeoutMinutes * MILLIS_PER_MINUTE
      : undefined;
  const resolved =
    input.optionsIdleTimeoutMs ??
    configuredMs ??
    (input.supportsNativeResume ? input.defaultIdleTimeoutMs : input.noNativeResumeIdleTimeoutMs);
  return Math.max(1, resolved);
}
