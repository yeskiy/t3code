import type {
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export const FORK_DELEGATION_TARGET_DISALLOWED_CONSTRAINT =
  "Not an allowed delegation target for this instance.";

type FailureFn = (code: OrchestratorMcpFailure["code"], message: string) => OrchestratorMcpFailure;

export function readAllowedDelegationTargets(
  settings: Pick<ServerSettings, "providerInstances">,
  callerInstanceId: ProviderInstanceId,
): ReadonlyArray<ProviderInstanceId> | undefined {
  if (!Object.hasOwn(settings.providerInstances, callerInstanceId)) return undefined;
  return settings.providerInstances[callerInstanceId]?.allowedDelegationTargets;
}

export function formatDisallowedDelegationTargetMessage(
  allowed: ReadonlyArray<ProviderInstanceId>,
): string {
  return allowed.length === 0
    ? "This provider instance cannot delegate."
    : `This provider instance may delegate only to: ${allowed.join(", ")}.`;
}

export function forkDelegationTargetConstraints(input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly callerInstanceId: ProviderInstanceId | undefined;
  readonly targetInstanceId: ProviderInstanceId;
}): ReadonlyArray<string> {
  if (input.callerInstanceId === undefined) return [];
  const allowed = readAllowedDelegationTargets(input.settings, input.callerInstanceId);
  if (allowed === undefined || allowed.includes(input.targetInstanceId)) return [];
  return [FORK_DELEGATION_TARGET_DISALLOWED_CONSTRAINT];
}

export const forkAssertDelegationTargetAllowed = (input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly callerInstanceId: ProviderInstanceId;
  readonly targetInstanceId: ProviderInstanceId;
  readonly failure: FailureFn;
}): Effect.Effect<void, OrchestratorMcpFailure> => {
  const allowed = readAllowedDelegationTargets(input.settings, input.callerInstanceId);
  if (allowed === undefined || allowed.includes(input.targetInstanceId)) {
    return Effect.void;
  }
  return Effect.fail(
    input.failure("invalid_request", formatDisallowedDelegationTargetMessage(allowed)),
  );
};

export const forkAssertRemoteDelegationAllowed = (input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly callerInstanceId: ProviderInstanceId;
  readonly failure: FailureFn;
}): Effect.Effect<void, OrchestratorMcpFailure> => {
  const allowed = readAllowedDelegationTargets(input.settings, input.callerInstanceId);
  if (allowed === undefined) return Effect.void;
  return Effect.fail(
    input.failure("invalid_request", formatDisallowedDelegationTargetMessage(allowed)),
  );
};
