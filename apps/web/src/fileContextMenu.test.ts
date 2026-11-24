import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { m } from "./i18n/messages";
import { buildFileContextMenuItems, resolveFileContextMenuAbsolutePath } from "./fileContextMenu";

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
  const capabilities = {
    revealLabel: "Reveal in File Explorer",
    canOpenDefault: true,
    editorIds: ["file-manager", "cursor", "vscode"] as const,
  };

  it("replaces upstream Open with Open in T3 when the fork alternate action is app", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      capabilities,
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
