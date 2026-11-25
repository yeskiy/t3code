import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const INSTANCE_ID_MAX_CHARS = 64;
const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export const ForkAllowedDelegationTargetId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(INSTANCE_ID_MAX_CHARS),
  Schema.isPattern(INSTANCE_ID_PATTERN),
).pipe(Schema.brand("ProviderInstanceId"));
export type ForkAllowedDelegationTargetId = typeof ForkAllowedDelegationTargetId.Type;

export const ForkAllowedDelegationTargets = Schema.Array(ForkAllowedDelegationTargetId);
export type ForkAllowedDelegationTargets = typeof ForkAllowedDelegationTargets.Type;

export const ForkDelegationTargetsFields = {
  allowedDelegationTargets: Schema.optionalKey(ForkAllowedDelegationTargets),
} as const;
