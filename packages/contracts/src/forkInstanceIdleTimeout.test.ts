import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  FORK_INSTANCE_IDLE_TIMEOUT_MAX_MINUTES,
  FORK_INSTANCE_IDLE_TIMEOUT_MIN_MINUTES,
  ForkInstanceIdleTimeoutMinutes,
} from "./forkInstanceIdleTimeout.ts";
import { ProviderInstanceConfig } from "./providerInstance.ts";

const decodeMinutes = Schema.decodeUnknownSync(ForkInstanceIdleTimeoutMinutes);
const decodeInstance = Schema.decodeUnknownSync(ProviderInstanceConfig);
const encodeInstance = Schema.encodeSync(ProviderInstanceConfig);

describe("ForkInstanceIdleTimeoutMinutes", () => {
  it("accepts integers from 1 to 1440", () => {
    expect(decodeMinutes(FORK_INSTANCE_IDLE_TIMEOUT_MIN_MINUTES)).toBe(1);
    expect(decodeMinutes(30)).toBe(30);
    expect(decodeMinutes(FORK_INSTANCE_IDLE_TIMEOUT_MAX_MINUTES)).toBe(1440);
  });

  it.each([0, -1, 1441, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "30", null])(
    "rejects invalid value %p",
    (invalid) => {
      expect(() => decodeMinutes(invalid)).toThrow();
    },
  );
});

describe("ProviderInstanceConfig idleTimeoutMinutes", () => {
  it("decodes with idleTimeoutMinutes omitted when absent", () => {
    const decoded = decodeInstance({ driver: "claudeAgent" });
    expect(decoded.idleTimeoutMinutes).toBeUndefined();
    expect("idleTimeoutMinutes" in decoded).toBe(false);
  });

  it("decodes and round-trips a valid idleTimeoutMinutes value", () => {
    const decoded = decodeInstance({ driver: "claudeAgent", idleTimeoutMinutes: 45 });
    expect(decoded.idleTimeoutMinutes).toBe(45);
    expect(encodeInstance(decoded)).toEqual({ driver: "claudeAgent", idleTimeoutMinutes: 45 });
  });

  it("rejects out-of-range idleTimeoutMinutes on the envelope", () => {
    expect(() => decodeInstance({ driver: "claudeAgent", idleTimeoutMinutes: 0 })).toThrow();
    expect(() => decodeInstance({ driver: "claudeAgent", idleTimeoutMinutes: 1441 })).toThrow();
    expect(() => decodeInstance({ driver: "claudeAgent", idleTimeoutMinutes: 2.5 })).toThrow();
  });
});
