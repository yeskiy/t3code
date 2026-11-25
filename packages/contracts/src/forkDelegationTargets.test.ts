import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ForkAllowedDelegationTargetId,
  ForkAllowedDelegationTargets,
} from "./forkDelegationTargets.ts";
import { ProviderInstanceConfig, ProviderInstanceId } from "./providerInstance.ts";

const decodeTargetId = Schema.decodeUnknownSync(ForkAllowedDelegationTargetId);
const decodeTargets = Schema.decodeUnknownSync(ForkAllowedDelegationTargets);
const decodeInstance = Schema.decodeUnknownSync(ProviderInstanceConfig);
const encodeInstance = Schema.encodeSync(ProviderInstanceConfig);

describe("ForkAllowedDelegationTargets", () => {
  it("accepts empty and non-empty arrays of valid instance ids", () => {
    expect(decodeTargets([])).toEqual([]);
    expect(decodeTargets(["claudeWork"])).toEqual([ProviderInstanceId.make("claudeWork")]);
    expect(decodeTargets(["claudeWork", "codex_1", "ant-2"])).toEqual([
      ProviderInstanceId.make("claudeWork"),
      ProviderInstanceId.make("codex_1"),
      ProviderInstanceId.make("ant-2"),
    ]);
  });

  it("matches ProviderInstanceId brand compatibility", () => {
    const id: ProviderInstanceId = decodeTargetId("claudeWork");
    expect(id).toBe(ProviderInstanceId.make("claudeWork"));
  });

  it.each(["", "   ", "123abc", "bad id", "a".repeat(65), 42, null])(
    "rejects invalid target id %p",
    (invalid) => {
      expect(() => decodeTargetId(invalid)).toThrow();
      expect(() => decodeTargets([invalid])).toThrow();
    },
  );

  it.each(["claudeWork", 42, null, {}])("rejects non-array value %p", (invalid) => {
    expect(() => decodeTargets(invalid)).toThrow();
  });
});

describe("ProviderInstanceConfig allowedDelegationTargets", () => {
  it("decodes with allowedDelegationTargets omitted when absent", () => {
    const decoded = decodeInstance({ driver: "claudeAgent" });
    expect(decoded.allowedDelegationTargets).toBeUndefined();
    expect("allowedDelegationTargets" in decoded).toBe(false);
  });

  it("decodes and round-trips an empty array to block all delegation", () => {
    const decoded = decodeInstance({ driver: "claudeAgent", allowedDelegationTargets: [] });
    expect(decoded.allowedDelegationTargets).toEqual([]);
    expect(encodeInstance(decoded)).toEqual({
      driver: "claudeAgent",
      allowedDelegationTargets: [],
    });
  });

  it("decodes and round-trips a non-empty allowedDelegationTargets array", () => {
    const decoded = decodeInstance({
      driver: "claudeAgent",
      allowedDelegationTargets: ["claudeWork", "codex"],
    });
    expect(decoded.allowedDelegationTargets).toEqual([
      ProviderInstanceId.make("claudeWork"),
      ProviderInstanceId.make("codex"),
    ]);
    expect(encodeInstance(decoded)).toEqual({
      driver: "claudeAgent",
      allowedDelegationTargets: ["claudeWork", "codex"],
    });
  });

  it("rejects invalid allowedDelegationTargets on the envelope", () => {
    expect(() =>
      decodeInstance({ driver: "claudeAgent", allowedDelegationTargets: ["bad id"] }),
    ).toThrow();
    expect(() =>
      decodeInstance({ driver: "claudeAgent", allowedDelegationTargets: "claudeWork" }),
    ).toThrow();
    expect(() =>
      decodeInstance({ driver: "claudeAgent", allowedDelegationTargets: null }),
    ).toThrow();
  });
});
