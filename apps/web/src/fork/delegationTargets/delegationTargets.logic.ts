import {
  ForkAllowedDelegationTargetId,
  type ForkAllowedDelegationTargets,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeTargetId = Schema.decodeUnknownOption(ForkAllowedDelegationTargetId);

export type ForkDelegationTargetsParseResult =
  | { readonly kind: "empty" }
  | { readonly kind: "valid"; readonly targets: ForkAllowedDelegationTargets }
  | { readonly kind: "invalid" };

export function parseForkDelegationTargetsInput(raw: string): ForkDelegationTargetsParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  const parts = trimmed.split(",").map((part) => part.trim());
  const decoded = parts.map((part) => decodeTargetId(part));
  if (decoded.some((result) => Option.isNone(result))) return { kind: "invalid" };
  const unique = [...new Set(decoded.filter(Option.isSome).map((result) => result.value))];
  return { kind: "valid", targets: unique };
}

export function formatForkDelegationTargets(
  value: ReadonlyArray<ProviderInstanceId> | undefined,
): string {
  return value === undefined || value.length === 0 ? "" : value.join(", ");
}

export function withForkAllowedDelegationTargets(
  instance: ProviderInstanceConfig,
  targets: ForkAllowedDelegationTargets | undefined,
): ProviderInstanceConfig {
  const { allowedDelegationTargets: _omit, ...rest } = instance;
  return targets === undefined
    ? (rest as ProviderInstanceConfig)
    : ({ ...rest, allowedDelegationTargets: targets } as ProviderInstanceConfig);
}
