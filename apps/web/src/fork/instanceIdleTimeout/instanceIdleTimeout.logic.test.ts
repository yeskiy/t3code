import { ProviderDriverKind, type ProviderInstanceConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatForkInstanceIdleTimeoutMinutes,
  parseForkInstanceIdleTimeoutInput,
  withForkInstanceIdleTimeoutMinutes,
} from "./instanceIdleTimeout.logic";

describe("parseForkInstanceIdleTimeoutInput", () => {
  it("returns empty for blank input", () => {
    expect(parseForkInstanceIdleTimeoutInput("")).toEqual({ kind: "empty" });
    expect(parseForkInstanceIdleTimeoutInput("   ")).toEqual({ kind: "empty" });
  });

  it.each([
    ["1", 1],
    [" 30 ", 30],
    ["1440", 1440],
  ])("parses valid input %p to %i minutes", (raw, expected) => {
    expect(parseForkInstanceIdleTimeoutInput(raw)).toEqual({ kind: "valid", minutes: expected });
  });

  it.each(["0", "-5", "1441", "1.5", "30m", "abc", "+10", "1e2"])(
    "rejects invalid input %p",
    (raw) => {
      expect(parseForkInstanceIdleTimeoutInput(raw)).toEqual({ kind: "invalid" });
    },
  );
});

describe("formatForkInstanceIdleTimeoutMinutes", () => {
  it("formats undefined as empty string and numbers as base-10 text", () => {
    expect(formatForkInstanceIdleTimeoutMinutes(undefined)).toBe("");
    expect(formatForkInstanceIdleTimeoutMinutes(45)).toBe("45");
  });
});

describe("withForkInstanceIdleTimeoutMinutes", () => {
  it("sets and clears idleTimeoutMinutes while preserving other envelope fields", () => {
    const base: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      enabled: true,
    };

    const updated = withForkInstanceIdleTimeoutMinutes(base, 30);
    expect(updated).toEqual({
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      enabled: true,
      idleTimeoutMinutes: 30,
    });

    const cleared = withForkInstanceIdleTimeoutMinutes(updated, undefined);
    expect(cleared).toEqual(base);
    expect("idleTimeoutMinutes" in cleared).toBe(false);
  });
});
