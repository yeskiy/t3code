import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  readInstanceIdleTimeoutMinutes,
  resolveInstanceIdleTimeoutMs,
} from "./resolveInstanceIdleTimeout.ts";

const DEFAULT_IDLE_MS = 2 * 60_000;
const NO_RESUME_IDLE_MS = 30 * 60_000;

describe("resolveInstanceIdleTimeoutMs", () => {
  it("gives optionsIdleTimeoutMs highest priority over instance config", () => {
    expect(
      resolveInstanceIdleTimeoutMs({
        optionsIdleTimeoutMs: 1_000,
        instanceIdleTimeoutMinutes: 45,
        supportsNativeResume: true,
        defaultIdleTimeoutMs: DEFAULT_IDLE_MS,
        noNativeResumeIdleTimeoutMs: NO_RESUME_IDLE_MS,
      }),
    ).toBe(1_000);
  });

  it("uses instanceIdleTimeoutMinutes converted to milliseconds when set", () => {
    expect(
      resolveInstanceIdleTimeoutMs({
        instanceIdleTimeoutMinutes: 15,
        supportsNativeResume: true,
        defaultIdleTimeoutMs: DEFAULT_IDLE_MS,
        noNativeResumeIdleTimeoutMs: NO_RESUME_IDLE_MS,
      }),
    ).toBe(15 * 60_000);
  });

  it("uses the native-resume default when no timeout is configured", () => {
    expect(
      resolveInstanceIdleTimeoutMs({
        supportsNativeResume: true,
        defaultIdleTimeoutMs: DEFAULT_IDLE_MS,
        noNativeResumeIdleTimeoutMs: NO_RESUME_IDLE_MS,
      }),
    ).toBe(DEFAULT_IDLE_MS);
  });

  it("uses the no-native-resume default when resume is unsupported and no timeout is configured", () => {
    expect(
      resolveInstanceIdleTimeoutMs({
        supportsNativeResume: false,
        defaultIdleTimeoutMs: DEFAULT_IDLE_MS,
        noNativeResumeIdleTimeoutMs: NO_RESUME_IDLE_MS,
      }),
    ).toBe(NO_RESUME_IDLE_MS);
  });

  it("clamps resolved timeouts to at least 1 ms", () => {
    expect(
      resolveInstanceIdleTimeoutMs({
        optionsIdleTimeoutMs: 0,
        supportsNativeResume: true,
        defaultIdleTimeoutMs: DEFAULT_IDLE_MS,
        noNativeResumeIdleTimeoutMs: NO_RESUME_IDLE_MS,
      }),
    ).toBe(1);
  });
});

describe("readInstanceIdleTimeoutMinutes", () => {
  it("returns the configured minutes for a matching instance id", () => {
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const codexId = ProviderInstanceId.make("codex");
    const settings = {
      providerInstances: {
        [claudeId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          idleTimeoutMinutes: 60,
        },
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
        },
      },
    };

    expect(readInstanceIdleTimeoutMinutes(settings, claudeId)).toBe(60);
    expect(readInstanceIdleTimeoutMinutes(settings, codexId)).toBeUndefined();
    expect(
      readInstanceIdleTimeoutMinutes(settings, ProviderInstanceId.make("missing")),
    ).toBeUndefined();
    expect(
      readInstanceIdleTimeoutMinutes(settings, ProviderInstanceId.make("toString")),
    ).toBeUndefined();
  });
});
