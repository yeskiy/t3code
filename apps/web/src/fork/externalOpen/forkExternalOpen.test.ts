import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const toastAddMock = vi.hoisted(() => vi.fn());

vi.mock("~/components/ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: {
    add: toastAddMock,
  },
}));

import { FORK_OPEN_FILES_IN_KEY } from "./externalOpen.logic";
import { openForkFileOrFallback, shouldForkOpenLocalFile } from "./forkExternalOpen";

const ENV_ID = EnvironmentId.make("host-env");

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("openForkFileOrFallback", () => {
  let memoryStorage: Storage;

  beforeEach(() => {
    toastAddMock.mockReset();
    memoryStorage = createMemoryStorage();
    vi.stubGlobal("window", {
      localStorage: memoryStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens local files through desktopBridge.forkOpenPath by default", async () => {
    const forkOpenPath = vi.fn(async () => ({ ok: true as const }));
    (window as unknown as { desktopBridge?: unknown }).desktopBridge = { forkOpenPath };
    const fallback = vi.fn();

    const opened = await openForkFileOrFallback({
      environmentId: ENV_ID,
      path: "docs/report.html",
      cwd: "E:\\Projects\\repo",
      fallback,
    });

    expect(opened).toBe(true);
    expect(forkOpenPath).toHaveBeenCalledWith({
      environmentId: ENV_ID,
      path: "E:\\Projects\\repo\\docs\\report.html",
    });
    expect(fallback).not.toHaveBeenCalled();
    expect(toastAddMock).not.toHaveBeenCalled();
  });

  it("falls back to T3 viewer when Open files in is set to app", async () => {
    memoryStorage.setItem(FORK_OPEN_FILES_IN_KEY, JSON.stringify("app"));
    const forkOpenPath = vi.fn(async () => ({ ok: true as const }));
    (window as unknown as { desktopBridge?: unknown }).desktopBridge = { forkOpenPath };
    const fallback = vi.fn();

    const opened = await openForkFileOrFallback({
      environmentId: ENV_ID,
      path: "docs/report.html",
      cwd: "E:\\Projects\\repo",
      fallback,
    });

    expect(opened).toBe(false);
    expect(forkOpenPath).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to T3 viewer when Alt is held", async () => {
    const forkOpenPath = vi.fn(async () => ({ ok: true as const }));
    (window as unknown as { desktopBridge?: unknown }).desktopBridge = { forkOpenPath };
    const fallback = vi.fn();

    const opened = await openForkFileOrFallback({
      environmentId: ENV_ID,
      path: "docs/report.html",
      cwd: "E:\\Projects\\repo",
      altKey: true,
      fallback,
    });

    expect(opened).toBe(false);
    expect(forkOpenPath).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to T3 viewer when the environment is not the desktop host", async () => {
    const forkOpenPath = vi.fn(async () => ({
      ok: false as const,
      reason: "not-host-environment" as const,
    }));
    (window as unknown as { desktopBridge?: unknown }).desktopBridge = { forkOpenPath };
    const fallback = vi.fn();

    const opened = await openForkFileOrFallback({
      environmentId: ENV_ID,
      path: "docs/report.html",
      cwd: "/remote/repo",
      fallback,
    });

    expect(opened).toBe(false);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(toastAddMock).not.toHaveBeenCalled();
  });

  it("shows an error toast and skips fallback when a file is missing or blocked", async () => {
    const forkOpenPath = vi.fn(async () => ({
      ok: false as const,
      reason: "blocked-executable" as const,
      error: "Executable and script files are not opened directly for safety.",
    }));
    (window as unknown as { desktopBridge?: unknown }).desktopBridge = { forkOpenPath };
    const fallback = vi.fn();

    const opened = await openForkFileOrFallback({
      environmentId: ENV_ID,
      path: "scripts/run.bat",
      cwd: "E:\\Projects\\repo",
      fallback,
    });

    expect(opened).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
    expect(toastAddMock).toHaveBeenCalledTimes(1);
  });

  it("checks synchronously whether a local file should open externally", () => {
    expect(shouldForkOpenLocalFile({ environmentId: ENV_ID })).toBe(false);

    (window as unknown as { desktopBridge?: unknown }).desktopBridge = {
      forkOpenPath: vi.fn(async () => ({ ok: true as const })),
    };
    expect(shouldForkOpenLocalFile({ environmentId: ENV_ID })).toBe(true);
    expect(shouldForkOpenLocalFile({ environmentId: ENV_ID, altKey: true })).toBe(false);
    expect(shouldForkOpenLocalFile({ environmentId: null })).toBe(false);

    memoryStorage.setItem(FORK_OPEN_FILES_IN_KEY, JSON.stringify("app"));
    expect(shouldForkOpenLocalFile({ environmentId: ENV_ID })).toBe(false);
  });
});
