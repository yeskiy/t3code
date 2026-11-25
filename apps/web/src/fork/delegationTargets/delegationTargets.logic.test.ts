import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatForkDelegationTargets,
  parseForkDelegationTargetsInput,
  withForkAllowedDelegationTargets,
} from "./delegationTargets.logic";

describe("parseForkDelegationTargetsInput", () => {
  it("returns empty for blank input", () => {
    expect(parseForkDelegationTargetsInput("")).toEqual({ kind: "empty" });
    expect(parseForkDelegationTargetsInput("   ")).toEqual({ kind: "empty" });
  });

  it("parses and deduplicates valid comma-separated instance ids", () => {
    expect(parseForkDelegationTargetsInput("claudeWork")).toEqual({
      kind: "valid",
      targets: [ProviderInstanceId.make("claudeWork")],
    });
    expect(parseForkDelegationTargetsInput(" claudeWork , codex , claudeWork ")).toEqual({
      kind: "valid",
      targets: [ProviderInstanceId.make("claudeWork"), ProviderInstanceId.make("codex")],
    });
  });

  it.each([",", "claudeWork,", ",claudeWork", "claudeWork,,codex", "bad id", "123abc", "a!b"])(
    "rejects invalid input %p",
    (raw) => {
      expect(parseForkDelegationTargetsInput(raw)).toEqual({ kind: "invalid" });
    },
  );
});

describe("formatForkDelegationTargets", () => {
  it("formats undefined and empty arrays as empty string and joins ids with commas", () => {
    expect(formatForkDelegationTargets(undefined)).toBe("");
    expect(formatForkDelegationTargets([])).toBe("");
    expect(
      formatForkDelegationTargets([
        ProviderInstanceId.make("claudeWork"),
        ProviderInstanceId.make("codex"),
      ]),
    ).toBe("claudeWork, codex");
  });
});

describe("withForkAllowedDelegationTargets", () => {
  it("sets, updates, and clears allowedDelegationTargets while preserving other fields", () => {
    const base: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude Work",
      enabled: true,
    };

    const restricted = withForkAllowedDelegationTargets(base, [
      ProviderInstanceId.make("claudeWork"),
    ]);
    expect(restricted).toEqual({
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude Work",
      enabled: true,
      allowedDelegationTargets: [ProviderInstanceId.make("claudeWork")],
    });

    const blockedAll = withForkAllowedDelegationTargets(restricted, []);
    expect(blockedAll).toEqual({
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude Work",
      enabled: true,
      allowedDelegationTargets: [],
    });

    const cleared = withForkAllowedDelegationTargets(blockedAll, undefined);
    expect(cleared).toEqual(base);
    expect("allowedDelegationTargets" in cleared).toBe(false);
  });
});
