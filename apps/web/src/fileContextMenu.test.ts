import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { m } from "./i18n/messages";
import {
  buildFileContextMenuItems,
  resolveFileContextMenuAbsolutePath,
  useFileContextMenu,
} from "./fileContextMenu";
import type { RemoteOpenResolution } from "./remoteOpen";

const state = vi.hoisted(() => ({
  remoteOpen: { state: { mode: "local-exec" }, isResolved: true } as RemoteOpenResolution,
  openInEditor: vi.fn(async () => ({ _tag: "Success" })),
  openRemoteEditorUrl: vi.fn(async (_url: string) => true),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    availableEditors: ["cursor", "file-manager"],
    shellRevealInFileManager: true,
    shellRevealInFileManagerKind: "xdg-open",
    environment: { platform: { os: "linux" } },
  }),
}));
vi.mock("gt-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("gt-react")>()),
  useMessages: () => (text: string) => text,
}));
vi.mock(import("./state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));
vi.mock("./editorMenuIcons", () => ({ useEditorMenuIcons: () => new Map() }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.openInEditor }));
vi.mock(import("./remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => state.remoteOpen,
  useRemoteCapableEditors: () => ["vscode"],
  openRemoteEditorUrl: state.openRemoteEditorUrl,
}));

const BASE_TARGET = {
  environmentId: EnvironmentId.make("environment-local"),
  filePath: "src/index.ts",
  workspaceRoot: "/workspace/project",
};

describe("resolveFileContextMenuAbsolutePath", () => {
  it("strips the repository prefix when the repo root is nested in the workspace", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "packages/app/src/index.ts",
      }),
    ).toBe("/workspace/project/packages/app/src/index.ts");
  });

  it("returns null for paths outside the workspace when a repository root is set", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "other/src/index.ts",
      }),
    ).toBeNull();
  });

  it("rejects absolute paths without a workspace root, matching diff path resolution", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: undefined,
        filePath: "/absolute/src/index.ts",
      }),
    ).toBeNull();
  });
});

describe("buildFileContextMenuItems", () => {
  const resolve = m;
  const editorIcons = new Map();
  const capabilities = {
    revealLabel: "Reveal in File Explorer",
    canOpenDefault: true,
    editorIds: ["file-manager", "cursor", "vscode"] as const,
  };

  it("replaces upstream Open with Open in T3 when the fork alternate action is app", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      capabilities,
      editorIcons,
      resolve,
      forkOpenEntry: { action: "app", label: "Open in T3" },
    });

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["fork-open-in-t3", "Open in T3"],
      ["reveal-in-folder", "Reveal in File Explorer"],
      ["open-with", "Open with"],
    ]);
  });

  it("replaces upstream Open with Open externally when the fork alternate action is external", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      capabilities,
      editorIcons,
      resolve,
      forkOpenEntry: { action: "external", label: "Open externally" },
    });

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["fork-open-external", "Open externally"],
      ["reveal-in-folder", "Reveal in File Explorer"],
      ["open-with", "Open with"],
    ]);
  });

  it("keeps the upstream Open entry when forkOpenEntry is null (remote host or directory)", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      capabilities,
      editorIcons,
      resolve,
      forkOpenEntry: null,
    });

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["open", "Open"],
      ["reveal-in-folder", "Reveal in File Explorer"],
      ["open-with", "Open with"],
    ]);
  });
});

describe("useFileContextMenu", () => {
  it.each<[string, RemoteOpenResolution]>([
    ["remote-unavailable", { state: { mode: "remote-unavailable" }, isResolved: true }],
    ["unresolved", { state: { mode: "local-exec" }, isResolved: false }],
  ])("offers no open actions when remote open is %s", async (_mode, resolution) => {
    state.remoteOpen = resolution;
    state.openInEditor.mockClear();
    const menu = useFileContextMenu(BASE_TARGET.environmentId);

    expect(menu.buildItems(BASE_TARGET)).toEqual([]);
    await menu.activate("open", BASE_TARGET);
    await menu.activate("editor:vscode", BASE_TARGET);
    expect(state.openInEditor).not.toHaveBeenCalled();
  });

  it("opens files over SSH remote links instead of on the server host", async () => {
    state.remoteOpen = {
      state: { mode: "remote-links", host: { kind: "ssh-alias", host: "box", username: "me" } },
      isResolved: true,
    };
    state.openInEditor.mockClear();
    state.openRemoteEditorUrl.mockClear();
    const menu = useFileContextMenu(BASE_TARGET.environmentId);

    expect(menu.buildItems(BASE_TARGET)).toEqual([
      {
        id: "open-with",
        label: "Open with",
        children: [{ id: "editor:vscode", label: "VS Code" }],
      },
    ]);
    await menu.activate("open", BASE_TARGET);
    await menu.activate("editor:vscode", BASE_TARGET);
    await menu.activate("editor:vscode", { ...BASE_TARGET, filePath: "src", isDirectory: true });
    expect(state.openInEditor).not.toHaveBeenCalled();
    expect(state.openRemoteEditorUrl.mock.calls).toEqual([
      ["vscode://vscode-remote/ssh-remote+me%40box/workspace/project/src/index.ts:1:1"],
      ["vscode://vscode-remote/ssh-remote+me%40box/workspace/project/src?windowId=_blank"],
    ]);
  });

  it("opens files on the server host when remote open is local-exec", async () => {
    state.remoteOpen = { state: { mode: "local-exec" }, isResolved: true };
    state.openInEditor.mockClear();
    const menu = useFileContextMenu(BASE_TARGET.environmentId);

    expect(menu.buildItems(BASE_TARGET).map((item) => item.id)).toEqual([
      "open",
      "reveal-in-folder",
      "open-with",
    ]);
    await menu.activate("open", BASE_TARGET);
    expect(state.openInEditor).toHaveBeenCalledWith({
      environmentId: BASE_TARGET.environmentId,
      input: { cwd: "/workspace/project/src/index.ts", editor: "file-manager" },
    });
  });
});
