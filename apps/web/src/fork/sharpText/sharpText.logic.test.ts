import { describe, expect, it } from "vite-plus/test";

import { resolveForkSharpText } from "./sharpText.logic";

describe("resolveForkSharpText", () => {
  it.each([
    { stored: null, platform: "Win32", expected: true },
    { stored: null, platform: "MacIntel", expected: false },
    { stored: false, platform: "Win32", expected: false },
    { stored: true, platform: "Linux x86_64", expected: false },
    { stored: true, platform: "Win32", expected: true },
  ])("stored=$stored platform=$platform -> $expected", ({ stored, platform, expected }) => {
    expect(resolveForkSharpText(stored, platform)).toBe(expected);
  });
});
