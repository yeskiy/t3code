import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { FORK_TRAY_NEW_THREAD_ACTION, handleForkTrayMenuAction } from "./forkTrayMenuAction";

it("starts a scratch thread on fork.newThread when available", () => {
  const startScratch = vi.fn(() => true);
  const openPicker = vi.fn();

  handleForkTrayMenuAction(FORK_TRAY_NEW_THREAD_ACTION, {
    startScratch,
    openPicker,
  });

  assert.equal(startScratch.mock.calls.length, 1);
  assert.equal(openPicker.mock.calls.length, 0);
});

it("falls back to the new-thread-in picker when scratch start returns false", () => {
  const startScratch = vi.fn(() => false);
  const openPicker = vi.fn();

  handleForkTrayMenuAction(FORK_TRAY_NEW_THREAD_ACTION, {
    startScratch,
    openPicker,
  });

  assert.equal(startScratch.mock.calls.length, 1);
  assert.equal(openPicker.mock.calls.length, 1);
});

it("ignores unrelated menu actions", () => {
  const startScratch = vi.fn(() => true);
  const openPicker = vi.fn();

  handleForkTrayMenuAction("open-settings", {
    startScratch,
    openPicker,
  });

  assert.equal(startScratch.mock.calls.length, 0);
  assert.equal(openPicker.mock.calls.length, 0);
});
