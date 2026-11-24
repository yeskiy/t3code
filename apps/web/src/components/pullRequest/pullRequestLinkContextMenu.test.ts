import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  showMenu: vi.fn(),
  openExternal: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock("~/localApi", () => ({
  readLocalApi: () => ({
    contextMenu: { show: state.showMenu },
    shell: { openExternal: state.openExternal },
  }),
}));

vi.mock("~/hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: state.copyText,
}));

vi.mock("../ui/toast", () => ({
  toastManager: { add: vi.fn() },
}));

import { FORK_OPEN_LINKS_IN_KEY } from "~/fork/externalOpen/externalOpen.logic";
import {
  pullRequestLinkContextMenuItems,
  showPullRequestLinkContextMenu,
} from "./pullRequestLinkContextMenu";

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

describe("pullRequestLinkContextMenu", () => {
  let storage: Storage;

  beforeEach(() => {
    state.showMenu.mockReset().mockResolvedValue(null);
    state.openExternal.mockReset().mockResolvedValue(undefined);
    state.copyText.mockReset().mockResolvedValue(true);
    storage = createMemoryStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds exactly one alternate open item alongside Copy link", () => {
    expect(
      pullRequestLinkContextMenuItems("Open on GitHub", {
        action: "app",
        label: "Open in T3",
      }).map((item) => [item.id, item.label]),
    ).toEqual([
      ["copy-link", "Copy link"],
      ["open-in-app", "Open in T3"],
    ]);

    expect(
      pullRequestLinkContextMenuItems("Open on GitHub", {
        action: "external",
        label: "Open externally",
      }).map((item) => [item.id, item.label]),
    ).toEqual([
      ["copy-link", "Copy link"],
      ["open-external", "Open externally"],
    ]);
  });

  it("shows Open in T3 and invokes onOpenInApp when Open links in is system", async () => {
    state.showMenu.mockResolvedValue("open-in-app");
    const onOpenInApp = vi.fn();

    await showPullRequestLinkContextMenu({
      url: "https://github.com/org/repo/pull/42",
      openLabel: "Open on GitHub",
      position: { x: 10, y: 20 },
      onOpenInApp,
      source: "mouse",
    });

    expect(state.showMenu).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "copy-link", label: "Copy link" }),
        expect.objectContaining({ id: "open-in-app", label: "Open in T3" }),
      ],
      { x: 10, y: 20 },
      "mouse",
    );
    expect(onOpenInApp).toHaveBeenCalledTimes(1);
    expect(state.openExternal).not.toHaveBeenCalled();
  });

  it("shows Open externally and calls openExternal when Open links in is app", async () => {
    storage.setItem(FORK_OPEN_LINKS_IN_KEY, JSON.stringify("app"));
    state.showMenu.mockResolvedValue("open-external");
    const onOpenInApp = vi.fn();

    await showPullRequestLinkContextMenu({
      url: "https://github.com/org/repo/pull/42",
      openLabel: "Open on GitHub",
      position: { x: 10, y: 20 },
      onOpenInApp,
      source: "mouse",
    });

    expect(state.showMenu).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "copy-link", label: "Copy link" }),
        expect.objectContaining({ id: "open-external", label: "Open externally" }),
      ],
      { x: 10, y: 20 },
      "mouse",
    );
    expect(state.openExternal).toHaveBeenCalledWith("https://github.com/org/repo/pull/42");
    expect(onOpenInApp).not.toHaveBeenCalled();
  });

  it("blocks unsafe URLs from openExternal", async () => {
    state.showMenu.mockResolvedValue("open-external");

    await showPullRequestLinkContextMenu({
      url: "javascript:alert(1)",
      openLabel: "Open on host",
      position: { x: 10, y: 20 },
      source: "mouse",
    });

    expect(state.openExternal).not.toHaveBeenCalled();
  });
});
