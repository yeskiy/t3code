import { assert, it } from "@effect/vitest";

import {
  DEFAULT_FORK_TRAY_FLAGS,
  decodeForkTrayFlags,
  encodeForkTrayFlags,
  resolveCloseToTraySetting,
  shouldHideOnClose,
} from "./DesktopTray.logic.ts";

it.each([
  {
    quitting: false,
    sessionEnding: false,
    closeToTray: true,
    hasTray: true,
    isMainWindow: true,
    platform: "win32" as const,
    expected: true,
  },
  {
    quitting: false,
    sessionEnding: false,
    closeToTray: true,
    hasTray: true,
    isMainWindow: true,
    platform: "linux" as const,
    expected: true,
  },
  {
    quitting: true,
    sessionEnding: false,
    closeToTray: true,
    hasTray: true,
    isMainWindow: true,
    platform: "win32" as const,
    expected: false,
  },
  {
    quitting: false,
    sessionEnding: true,
    closeToTray: true,
    hasTray: true,
    isMainWindow: true,
    platform: "win32" as const,
    expected: false,
  },
  {
    quitting: false,
    sessionEnding: false,
    closeToTray: false,
    hasTray: true,
    isMainWindow: true,
    platform: "win32" as const,
    expected: false,
  },
  {
    quitting: false,
    sessionEnding: false,
    closeToTray: true,
    hasTray: false,
    isMainWindow: true,
    platform: "win32" as const,
    expected: false,
  },
  {
    quitting: false,
    sessionEnding: false,
    closeToTray: true,
    hasTray: true,
    isMainWindow: false,
    platform: "win32" as const,
    expected: false,
  },
  {
    quitting: false,
    sessionEnding: false,
    closeToTray: true,
    hasTray: true,
    isMainWindow: true,
    platform: "darwin" as const,
    expected: false,
  },
])("shouldHideOnClose %o", (row) => {
  assert.equal(shouldHideOnClose(row), row.expected);
});

it("decodes missing or invalid flag files to defaults and merges partial JSON", () => {
  assert.deepEqual(decodeForkTrayFlags(undefined), DEFAULT_FORK_TRAY_FLAGS);
  assert.deepEqual(decodeForkTrayFlags("{not json"), DEFAULT_FORK_TRAY_FLAGS);
  assert.deepEqual(decodeForkTrayFlags('{"closeToTray":false}'), {
    closeToTray: false,
    openAtLogin: false,
    startHidden: true,
  });
  const encoded = encodeForkTrayFlags({
    closeToTray: false,
    openAtLogin: true,
    startHidden: false,
  });
  assert.deepEqual(decodeForkTrayFlags(encoded), {
    closeToTray: false,
    openAtLogin: true,
    startHidden: false,
  });
});

it.each([
  { closeToTray: true, envValue: undefined, expected: true },
  { closeToTray: false, envValue: undefined, expected: false },
  { closeToTray: true, envValue: "0", expected: false },
  { closeToTray: true, envValue: " 0 ", expected: false },
  { closeToTray: false, envValue: "1", expected: true },
  { closeToTray: false, envValue: "other", expected: false },
])("resolveCloseToTraySetting %o", ({ closeToTray, envValue, expected }) => {
  assert.equal(
    resolveCloseToTraySetting({ ...DEFAULT_FORK_TRAY_FLAGS, closeToTray }, envValue),
    expected,
  );
});
