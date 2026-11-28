import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const mockTurnItems = vi.hoisted(() => ({
  current: [] as ReadonlyArray<ThreadStructureVisibleTurnItem>,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "project-1",
          environmentId: "env-1",
          title: "Project",
          workspaceRoot: "/work/project",
          scripts: [],
        }) as never,
  useProjects: (() => []) as never,
  useQuietThreadShell: ((ref: unknown) =>
    ref === null
      ? null
      : {
          id: "thread-1",
          environmentId: "env-1",
          projectId: "project-1",
          worktreePath: "/work/project",
          branch: null,
          pullRequests: [],
        }) as never,
  useQuietThreadVisibleTurnItems: () => mockTurnItems.current,
  useServerConfigs: (() =>
    new Map([
      [
        EnvironmentId.make("env-1"),
        {
          scratchWorkspaceRoot: "/home/user/.t3/scratch",
          environment: { capabilities: { pullRequests: false } },
        },
      ],
    ])) as never,
}));

vi.mock(import("~/state/vcs"), async (importOriginal) => {
  const actual = await importOriginal();
  const notARepo = Atom.make(
    AsyncResult.success({
      isRepo: false,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: 0,
      pr: null,
    }),
  );
  return {
    ...actual,
    vcsEnvironment: { ...actual.vcsEnvironment, status: (() => notARepo) as never },
  };
});

import { ChatCanvasContext } from "~/components/chat/ChatCanvasContext";
import { resolveChatCanvasLayout } from "~/components/chat/chatCanvasLayout";
import { ThreadDetailsPanel } from "~/components/chat/ThreadDetailsPanel";
import { ThreadDetailsItemsRow } from "~/components/settings/ThreadDetailsItemsRow";
import { PopoverCreateHandle } from "~/components/ui/popover";
import { removeLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  getClientSettings,
} from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { render } from "../../../test/render";
import { FORK_ARTIFACTS_ENABLED_KEY, ForkArtifactsEnabled } from "./artifacts.logic";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};
const container = { width: 1200, height: 800 };
const placement = { x: 908, y: 200, right: 12, width: 280, height: 400 } as const;

function renderRow(
  id: string,
  attachmentId: string,
  title: string,
): ThreadStructureVisibleTurnItem {
  return {
    sourceThreadId: threadRef.threadId,
    sourceItemId: id,
    item: {
      id,
      runId: "run-1",
      type: "dynamic_tool",
      status: "completed",
      toolName: "mcp__t3-code__html_render",
      startedAt: DateTime.makeUnsafe("2026-11-24T10:00:00.000Z"),
      updatedAt: DateTime.makeUnsafe("2026-11-24T10:00:00.000Z"),
      output: {
        htmlRender: {
          attachmentId,
          title,
          height: 320,
        },
      },
    },
  } as unknown as ThreadStructureVisibleTurnItem;
}

function setup(threadDetailsItems: Record<string, boolean> = {}) {
  mockTurnItems.current = [renderRow("item-1", "att-1-html", "Summary chart")];
  removeLocalStorageItem(FORK_ARTIFACTS_ENABLED_KEY);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    threadDetailsItems,
  });
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
  });
  const anchor = document.createElement("div");
  document.body.append(anchor);
  return {
    anchor: { current: anchor },
    handle: PopoverCreateHandle(),
    [Symbol.dispose]: () => {
      anchor.remove();
      removeLocalStorageItem(FORK_ARTIFACTS_ENABLED_KEY);
      __resetClientSettingsPersistenceForTests();
      mockTurnItems.current = [];
    },
  };
}

function PanelFixture({ fixture }: { fixture: ReturnType<typeof setup> }) {
  const noop = () => {};
  const scriptResult = async () => ({ ok: true }) as never;
  return (
    <ChatCanvasContext
      value={{
        container,
        lane: { padding: 48, minChatWidth: 640 },
        layout: resolveChatCanvasLayout({ container, preview: null }),
        previewKey: null,
        registerTimeline: noop,
        measureDetailsCard: noop,
        detailsCardTopInset: 0,
        preferredDetailsCard: placement,
        detailsCardPlacement: placement,
      }}
    >
      <ThreadDetailsPanel
        anchor={fixture.anchor}
        handle={fixture.handle}
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        projectId={ProjectId.make("project-1")}
        composerDraftTarget={threadRef}
        worktreePath="/work/project"
        isServerThread
        activeProjectName="Project"
        activeProjectScripts={undefined}
        preferredScriptId={null}
        keybindings={[]}
        availableEditors={[]}
        showOpenInPicker={false}
        openInShortcutEnabled={false}
        gitCwd="/work/project"
        workspaceMutationId={null}
        isGitRepo={false}
        offersWorkspaceModes={false}
        envLocked
        availableEnvironments={[]}
        onEnvModeChange={noop}
        envMode="local"
        startFromOrigin={false}
        onStartFromOriginChange={noop}
        onComposerFocusRequest={noop}
        onRunProjectScript={noop}
        onAddProjectScript={scriptResult}
        onUpdateProjectScript={scriptResult}
        onDeleteProjectScript={scriptResult}
        usage={{} as never}
        taskList={null}
      />
    </ChatCanvasContext>
  );
}

describe("Artifacts in Show in thread details", () => {
  it("lists Artifacts as checked by default, toggles it, and resets to default", async () => {
    using _fixture = setup();
    await using screen = await render(<ThreadDetailsItemsRow />);

    const trigger = screen.getByRole("button", { name: "Thread details: 11 of 14 on" });
    await expect.element(trigger).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Reset thread details to default" }))
      .not.toBeInTheDocument();

    await userEvent.click(trigger);

    const artifactsChoice = page.getByRole("menuitemcheckbox", { name: "Artifacts" });
    await expect.element(artifactsChoice).toBeVisible();
    await expect.element(artifactsChoice).toHaveAttribute("aria-checked", "true");

    await userEvent.click(artifactsChoice);

    expect(getClientSettings().threadDetailsItems).toEqual({ artifacts: false });
    await expect
      .element(screen.getByRole("button", { name: "Thread details: 10 of 14 on" }))
      .toBeVisible();

    await userEvent.keyboard("{Escape}");

    const resetButton = screen.getByRole("button", { name: "Reset thread details to default" });
    await expect.element(resetButton).toBeVisible();
    await userEvent.click(resetButton);

    expect(getClientSettings().threadDetailsItems).toEqual({});
    await expect
      .element(screen.getByRole("button", { name: "Thread details: 11 of 14 on" }))
      .toBeVisible();
  });

  it("hides the Artifacts choice and adjusts counts when Show renders as artifacts is off", async () => {
    using _fixture = setup({ artifacts: false });
    setLocalStorageItem(FORK_ARTIFACTS_ENABLED_KEY, false, ForkArtifactsEnabled);
    await using screen = await render(<ThreadDetailsItemsRow />);

    const trigger = screen.getByRole("button", { name: "Thread details: 10 of 13 on" });
    await expect.element(trigger).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Reset thread details to default" }))
      .not.toBeInTheDocument();

    await userEvent.click(trigger);

    await expect
      .element(page.getByRole("menuitemcheckbox", { name: "Artifacts" }))
      .not.toBeInTheDocument();
  });

  it("hides the Artifacts row in ThreadDetailsPanel when unchecked in settings", async () => {
    using fixture = setup();
    await using _screen = await render(
      <>
        <div className="max-w-md">
          <ThreadDetailsItemsRow />
        </div>
        <PanelFixture fixture={fixture} />
      </>,
    );

    const artifactsRow = page.getByRole("button", { name: /Artifacts\s*1/ });
    await expect.element(artifactsRow).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Thread details: 11 of 14 on" }));
    await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Artifacts" }));

    await expect.element(artifactsRow).not.toBeInTheDocument();
  });
});
