import {
  AuthFilesystemReadScope,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { createElement, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  sessions: new Map<string, Pick<AuthSessionState, "authenticated" | "scopes">>(),
  mint: vi.fn(),
  download: vi.fn(),
  png: vi.fn(),
  showMenu: vi.fn(),
  openExternal: vi.fn(),
  openFile: vi.fn(),
  clipboard: vi.fn(),
  copyText: vi.fn(),
  menuFinished: null as (() => void) | null,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <A,>(callback: A) => callback,
  useRef: <A,>(current: A) => ({ current }),
  useState: <A,>(initial: A) => [initial, () => {}],
}));
vi.mock("../../hooks/useCopyToClipboard", () => ({ writeTextToClipboard: state.copyText }));
vi.mock("../../localApi", () => ({
  readLocalApi: () => ({
    contextMenu: { show: state.showMenu },
    shell: { openExternal: state.openExternal },
  }),
}));
vi.mock("../../state/assets", () => ({ assetEnvironment: { createUrl: {} } }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.mint }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: (environmentId: string) => environmentId },
  readPreparedConnection: () => ({ httpBaseUrl: "https://host.test" }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (environmentId: string) => ({
    data: state.sessions.get(environmentId) ?? null,
    error: null,
  }),
}));
vi.mock("../../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) => {
      if (typeof atom !== "string") return null;
      const session = state.sessions.get(atom);
      return session === undefined ? AsyncResult.initial() : AsyncResult.success(session);
    },
  },
}));
vi.mock("./mediaContent", () => ({ downloadMedia: state.download, readMediaPng: state.png }));
vi.mock("../ui/tooltip", () => ({
  Tooltip: "Tooltip",
  TooltipTrigger: "TooltipTrigger",
  TooltipPopup: "TooltipPopup",
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: <A,>(toast: A) => toast,
  toastManager: {
    add: (toast: { type: string }) => {
      if (toast.type !== "loading") state.menuFinished?.();
      return "toast";
    },
    update: () => state.menuFinished?.(),
  },
}));

import {
  FORK_OPEN_FILES_IN_KEY,
  FORK_OPEN_LINKS_IN_KEY,
} from "../../fork/externalOpen/externalOpen.logic";
import { MediaActions, useMediaActions, type MediaActionSource } from "./MediaActions";

const environmentId = EnvironmentId.make("media-environment");
const threadId = ThreadId.make("media-thread");
const granted: Pick<AuthSessionState, "authenticated" | "scopes"> = {
  authenticated: true,
  scopes: [AuthFilesystemReadScope],
};
const denied: Pick<AuthSessionState, "authenticated" | "scopes"> = {
  authenticated: true,
  scopes: [],
};

function hostSource(_tag: "workspace-file" | "media-file" = "media-file"): MediaActionSource {
  return {
    kind: "image",
    name: "image.png",
    src: null,
    asset: { environmentId, resource: { _tag, threadId, path: "/repo/image.png" } },
    reference: { kind: "file", path: "/repo/image.png", relativePath: "image.png" },
    onOpenFile: state.openFile,
  };
}

function openMenu(source: MediaActionSource) {
  const find = (node: ReactNode): ((event: unknown) => void) | undefined => {
    if (Array.isArray(node)) return node.map(find).find((handler) => handler !== undefined);
    if (!isValidElement<{ children?: ReactNode; onContextMenu?: (event: unknown) => void }>(node))
      return undefined;
    return node.props.onContextMenu ?? find(node.props.children);
  };
  const handler = find(MediaActions({ source, children: createElement("img") }));
  if (!handler) throw new Error("Media menu handler missing");
  handler({
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) },
    clientX: 1,
    clientY: 1,
  });
}

beforeEach(() => {
  state.sessions.clear();
  state.sessions.set(environmentId, denied);
  state.mint
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 }));
  state.download.mockReset().mockResolvedValue(undefined);
  state.png.mockReset().mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  state.showMenu.mockReset().mockResolvedValue(null);
  state.openExternal.mockReset().mockResolvedValue(undefined);
  state.openFile.mockReset();
  state.copyText.mockReset().mockResolvedValue(true);
  state.menuFinished = null;
  class TestClipboardItem {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }
  state.clipboard.mockReset().mockImplementation(async (items: TestClipboardItem[]) => {
    await Promise.all(items.flatMap((item) => Object.values(item.items)));
  });
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write: state.clipboard } });
});

afterEach(() => vi.unstubAllGlobals());

it.each(["workspace-file", "media-file"] as const)(
  "disables denied %s byte actions and prevents imperative requests",
  async (_tag) => {
    const source = hostSource(_tag);
    openMenu(source);
    expect(state.showMenu).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "save", disabled: true }),
        expect.objectContaining({ id: "copy-image", disabled: true }),
        expect.objectContaining({ id: "open-file", disabled: true }),
      ]),
      { x: 1, y: 1 },
    );
    await expect(useMediaActions(source).save()).rejects.toThrow("cannot read host files");
    await expect(useMediaActions(source).copyImage()).rejects.toThrow("cannot read host files");
    expect(state.mint).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.clipboard).not.toHaveBeenCalled();
  },
);

it.each(["save", "copy-image", "open-file"])(
  "rechecks access when %s is selected from an already open native menu",
  async (action) => {
    state.sessions.set(environmentId, granted);
    const choice = deferred<string>();
    const completed = deferred<void>();
    state.showMenu.mockReturnValue(choice.promise);
    state.menuFinished = () => completed.resolve();
    state.openFile.mockImplementation(() => completed.resolve());
    openMenu(hostSource());

    state.sessions.set(environmentId, denied);
    choice.resolve(action);
    await completed.promise;

    expect(state.mint).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
    expect(state.clipboard).not.toHaveBeenCalled();
    expect(state.openFile).not.toHaveBeenCalled();
  },
);

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

it("offers Open in T3 when Open files in is external and Open externally when set to app", async () => {
  state.sessions.set(environmentId, granted);
  const storage = createMemoryStorage();
  const forkOpenPath = vi.fn(async () => ({ ok: true as const }));
  vi.stubGlobal("window", {
    localStorage: storage,
    desktopBridge: { forkOpenPath },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });

  state.showMenu.mockResolvedValueOnce("open-file");
  openMenu(hostSource());
  expect(state.showMenu).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining({ id: "open-file", label: "Open in T3" })]),
    { x: 1, y: 1 },
  );
  await vi.waitFor(() => expect(state.openFile).toHaveBeenCalledTimes(1));
  expect(forkOpenPath).not.toHaveBeenCalled();

  storage.setItem(FORK_OPEN_FILES_IN_KEY, JSON.stringify("app"));
  state.showMenu.mockResolvedValueOnce("fork-open-external");
  openMenu(hostSource());
  expect(state.showMenu).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "fork-open-external", label: "Open externally" }),
    ]),
    { x: 1, y: 1 },
  );
  await vi.waitFor(() =>
    expect(forkOpenPath).toHaveBeenCalledWith({ environmentId, path: "/repo/image.png" }),
  );
});

it("offers Open in T3 or Open externally for web URL media based on Open links in", async () => {
  const storage = createMemoryStorage();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  const onOpenInApp = vi.fn();
  const webSource: MediaActionSource = {
    kind: "image",
    name: "photo.png",
    src: "https://example.com/photo.png",
    reference: { kind: "url", url: "https://example.com/photo.png" },
    onOpenInApp,
  };

  state.showMenu.mockResolvedValueOnce("fork-open-in-t3");
  openMenu(webSource);
  expect(state.showMenu).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "fork-open-in-t3", label: "Open in T3" }),
    ]),
    { x: 1, y: 1 },
  );
  await vi.waitFor(() => expect(onOpenInApp).toHaveBeenCalledTimes(1));

  storage.setItem(FORK_OPEN_LINKS_IN_KEY, JSON.stringify("app"));
  state.showMenu.mockResolvedValueOnce("fork-open-external");
  openMenu(webSource);
  expect(state.showMenu).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "fork-open-external", label: "Open externally" }),
    ]),
    { x: 1, y: 1 },
  );
  await vi.waitFor(() =>
    expect(state.openExternal).toHaveBeenCalledWith("https://example.com/photo.png"),
  );
});

it("offers Open in T3 (lightbox) or Open externally for outside-workspace local images", async () => {
  state.sessions.set(environmentId, granted);
  const storage = createMemoryStorage();
  const forkOpenPath = vi.fn(async () => ({ ok: true as const }));
  vi.stubGlobal("window", {
    localStorage: storage,
    desktopBridge: { forkOpenPath },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  const onOpenInApp = vi.fn();
  const externalLocalSource: MediaActionSource = {
    kind: "image",
    name: "shot.png",
    src: "http://host/assets/shot.png",
    reference: { kind: "file", path: "/tmp/shot.png" },
    asset: {
      environmentId,
      resource: {
        _tag: "media-file",
        threadId: ThreadId.make("thread-1"),
        path: "/tmp/shot.png",
      },
    },
    onOpenInApp,
  };

  state.showMenu.mockResolvedValueOnce("fork-open-in-t3");
  openMenu(externalLocalSource);
  expect(state.showMenu).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: "fork-open-in-t3", label: "Open in T3", disabled: false }),
    ]),
    { x: 1, y: 1 },
  );
  await vi.waitFor(() => expect(onOpenInApp).toHaveBeenCalledTimes(1));
  expect(forkOpenPath).not.toHaveBeenCalled();

  storage.setItem(FORK_OPEN_FILES_IN_KEY, JSON.stringify("app"));
  state.showMenu.mockResolvedValueOnce("fork-open-external");
  openMenu(externalLocalSource);
  expect(state.showMenu).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        id: "fork-open-external",
        label: "Open externally",
        disabled: false,
      }),
    ]),
    { x: 1, y: 1 },
  );
  await vi.waitFor(() =>
    expect(forkOpenPath).toHaveBeenCalledWith({ environmentId, path: "/tmp/shot.png" }),
  );
});
