import * as Schema from "effect/Schema";

export const FORK_INSTANCE_IDLE_TIMEOUT_MIN_MINUTES = 1;
export const FORK_INSTANCE_IDLE_TIMEOUT_MAX_MINUTES = 1440;

export const ForkInstanceIdleTimeoutMinutes = Schema.Int.check(
  Schema.isBetween({
    minimum: FORK_INSTANCE_IDLE_TIMEOUT_MIN_MINUTES,
    maximum: FORK_INSTANCE_IDLE_TIMEOUT_MAX_MINUTES,
  }),
);
export type ForkInstanceIdleTimeoutMinutes = typeof ForkInstanceIdleTimeoutMinutes.Type;

export const ForkInstanceIdleTimeoutFields = {
  idleTimeoutMinutes: Schema.optionalKey(ForkInstanceIdleTimeoutMinutes),
} as const;
