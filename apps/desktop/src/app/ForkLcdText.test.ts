import { assert, it } from "@effect/vitest";

import { applyForkLcdTextSwitches } from "./ForkLcdText.ts";

const commandLine = (existing: ReadonlyArray<string> = []) => {
  const added: Array<string> = [];
  return {
    added,
    hasSwitch: (name: string) => existing.includes(name) || added.includes(name),
    appendSwitch: (name: string) => void added.push(name),
  };
};

it("adds both switches on Windows", () => {
  const line = commandLine();
  const added = applyForkLcdTextSwitches({ platform: "win32", env: {}, commandLine: line });
  assert.deepEqual(added, ["enable-lcd-text", "disable-prefer-compositing-to-lcd-text"]);
  assert.deepEqual(line.added, ["enable-lcd-text", "disable-prefer-compositing-to-lcd-text"]);
});

it.each([
  { name: "macOS", platform: "darwin", env: {}, existing: [] },
  { name: "Linux", platform: "linux", env: {}, existing: [] },
  { name: "flag off", platform: "win32", env: { T3_FORK_LCD_TEXT: "0" }, existing: [] },
  {
    name: "flag off with spaces",
    platform: "win32",
    env: { T3_FORK_LCD_TEXT: " 0 " },
    existing: [],
  },
] as const)("adds nothing: $name", ({ platform, env, existing }) => {
  const line = commandLine(existing);
  const added = applyForkLcdTextSwitches({ platform, env, commandLine: line });
  assert.deepEqual(added, []);
  assert.deepEqual(line.added, []);
});

it("adds both switches when flag is explicitly enabled", () => {
  const line = commandLine();
  const added = applyForkLcdTextSwitches({
    platform: "win32",
    env: { T3_FORK_LCD_TEXT: "1" },
    commandLine: line,
  });
  assert.deepEqual(added, ["enable-lcd-text", "disable-prefer-compositing-to-lcd-text"]);
  assert.deepEqual(line.added, ["enable-lcd-text", "disable-prefer-compositing-to-lcd-text"]);
});

it("does not repeat a switch from the launcher", () => {
  const line = commandLine(["enable-lcd-text"]);
  const added = applyForkLcdTextSwitches({ platform: "win32", env: {}, commandLine: line });
  assert.deepEqual(added, ["disable-prefer-compositing-to-lcd-text"]);
  assert.deepEqual(line.added, ["disable-prefer-compositing-to-lcd-text"]);
});
