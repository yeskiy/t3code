import "~/index.css";

import { RegistryContext } from "@effect/atom-react";
import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
  useClientSettings: () => false,
}));
vi.mock("~/components/SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

import { ComposerPrimaryActions } from "~/components/chat/ComposerPrimaryActions";
import { retainThreadOverlaysForThread } from "~/components/chat/threadOverlayRetention";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import {
  ForkStopBackgroundConfirmHost,
  openForkStopBackgroundConfirm,
} from "./ForkStopBackgroundConfirmHost";
import { composerStopLabel } from "./composerStop.logic";

const THREAD_KEY = "env-1:thread-1";

const SAMPLE_TASKS: ReadonlyArray<OrchestrationV2PendingBackgroundTask> = [
  { taskId: "cmd-1", kind: "command" },
  { taskId: "sub-1", kind: "subagent" },
  { taskId: "del-1", kind: "subagent" },
];

const SAMPLE_TURN_ITEMS = [
  { id: "sub-1", type: "subagent", origin: "provider_native" },
  { id: "del-1", type: "subagent", origin: "app_owned" },
];

function makePrimaryActionsProps(
  overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {},
) {
  return {
    compact: true,
    canOperateThread: true,
    pendingAction: null,
    isRunning: true,
    canInterrupt: true,
    canResume: false,
    isSendBusy: false,
    sendDisabledReason: null,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onPreviousPendingQuestion: vi.fn(),
    onInterrupt: vi.fn(),
    onResume: vi.fn(),
    onSubmitMessage: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof ComposerPrimaryActions>;
}

describe("ForkStopBackgroundConfirmHost", () => {
  it("opens with Cancel focused by default, and Cancel sends nothing", async () => {
    retainThreadOverlaysForThread(null);
    const onConfirm = vi.fn();
    await using _screen = await render(
      <RegistryContext value={appAtomRegistry}>
        <ForkStopBackgroundConfirmHost
          threadKey={THREAD_KEY}
          tasks={SAMPLE_TASKS}
          turnItems={SAMPLE_TURN_ITEMS}
          canOperateThread
          onConfirm={onConfirm}
        />
      </RegistryContext>,
      { router: false },
    );

    await act(() => {
      openForkStopBackgroundConfirm(THREAD_KEY);
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Stop background work?" }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "1 command, 1 subagent, and 1 delegated task are running in the background. All background work will stop.",
        ),
      )
      .toBeVisible();

    const cancelButton = page.getByRole("button", { name: "Cancel", exact: true });
    await expect.element(cancelButton).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    // Also verify clicking Cancel directly sends nothing.
    await act(() => {
      openForkStopBackgroundConfirm(THREAD_KEY);
    });
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm once when Stop all is clicked", async () => {
    retainThreadOverlaysForThread(null);
    const onConfirm = vi.fn();
    await using _screen = await render(
      <RegistryContext value={appAtomRegistry}>
        <ForkStopBackgroundConfirmHost
          threadKey={THREAD_KEY}
          tasks={[{ taskId: "cmd-1", kind: "command" }]}
          turnItems={[]}
          canOperateThread
          onConfirm={onConfirm}
        />
      </RegistryContext>,
      { router: false },
    );

    await act(() => {
      openForkStopBackgroundConfirm(THREAD_KEY);
    });

    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Stop all", exact: true }));

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes without confirming when switching threads", async () => {
    retainThreadOverlaysForThread(null);
    const onConfirm = vi.fn();
    await using _screen = await render(
      <RegistryContext value={appAtomRegistry}>
        <ForkStopBackgroundConfirmHost
          threadKey={THREAD_KEY}
          tasks={[{ taskId: "cmd-1", kind: "command" }]}
          turnItems={[]}
          canOperateThread
          onConfirm={onConfirm}
        />
      </RegistryContext>,
      { router: false },
    );

    await act(() => {
      openForkStopBackgroundConfirm(THREAD_KEY);
    });
    await expect.element(page.getByRole("alertdialog")).toBeVisible();

    await act(() => {
      retainThreadOverlaysForThread("env-1:thread-2");
    });
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("ComposerPrimaryActions stop-scope labels and confirmation guard", () => {
  it("uses the fork stop labels and keeps Stop clickable when confirmation is required", async () => {
    const onInterrupt = vi.fn();
    const stopLabel = composerStopLabel({ turnRunning: false, backgroundCount: 1 });
    await using screen = await render(
      <ComposerPrimaryActions
        {...makePrimaryActionsProps({
          isRunning: false,
          canInterrupt: true,
          stopLabel,
          stopRequiresConfirm: true,
          onInterrupt,
        })}
      />,
      { router: false },
    );

    const stopButton = screen.getByRole("button", { name: "Stop background work", exact: true });
    await expect.element(stopButton).toBeEnabled();
    await userEvent.click(stopButton);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    await expect.element(stopButton).toBeEnabled();

    await screen.rerender(
      <ComposerPrimaryActions
        {...makePrimaryActionsProps({
          isRunning: true,
          canInterrupt: true,
          stopLabel: composerStopLabel({ turnRunning: true, backgroundCount: 2 }),
          stopRequiresConfirm: false,
          onInterrupt,
        })}
      />,
    );
    await expect
      .element(
        screen.getByRole("button", {
          name: "Stop turn (background work keeps running)",
          exact: true,
        }),
      )
      .toBeEnabled();

    await screen.rerender(
      <ComposerPrimaryActions
        {...makePrimaryActionsProps({
          isRunning: true,
          canInterrupt: true,
          stopLabel: composerStopLabel({ turnRunning: true, backgroundCount: 0 }),
          stopRequiresConfirm: false,
          onInterrupt,
        })}
      />,
    );
    await expect
      .element(screen.getByRole("button", { name: "Stop turn", exact: true }))
      .toBeEnabled();
  });
});
