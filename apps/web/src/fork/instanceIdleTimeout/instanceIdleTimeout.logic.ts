import { ForkInstanceIdleTimeoutMinutes, type ProviderInstanceConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const DIGITS_ONLY_PATTERN = /^\d+$/;
const decodeMinutes = Schema.decodeUnknownOption(ForkInstanceIdleTimeoutMinutes);

export type ForkInstanceIdleTimeoutParseResult =
  | { readonly kind: "empty" }
  | { readonly kind: "valid"; readonly minutes: ForkInstanceIdleTimeoutMinutes }
  | { readonly kind: "invalid" };

export function parseForkInstanceIdleTimeoutInput(raw: string): ForkInstanceIdleTimeoutParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (!DIGITS_ONLY_PATTERN.test(trimmed)) return { kind: "invalid" };
  const parsed = decodeMinutes(Number(trimmed));
  return Option.isSome(parsed) ? { kind: "valid", minutes: parsed.value } : { kind: "invalid" };
}

export function formatForkInstanceIdleTimeoutMinutes(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

export function withForkInstanceIdleTimeoutMinutes(
  instance: ProviderInstanceConfig,
  minutes: ForkInstanceIdleTimeoutMinutes | undefined,
): ProviderInstanceConfig {
  const { idleTimeoutMinutes: _omit, ...rest } = instance;
  return minutes === undefined
    ? (rest as ProviderInstanceConfig)
    : ({ ...rest, idleTimeoutMinutes: minutes } as ProviderInstanceConfig);
}
