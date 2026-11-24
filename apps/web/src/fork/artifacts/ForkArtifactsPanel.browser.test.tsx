import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { removeLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { render } from "../../../test/render";

const mockTurnItems = vi.hoisted(() => ({
  current: [] as ReadonlyArray<ThreadStructureVisibleTurnItem>,
}));
const mockAssetUrl = vi.hoisted(() => ({ current: "about:blank" }));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadVisibleTurnItems: () => mockTurnItems.current,
}));
vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success" as const,
    url: mockAssetUrl.current,
    expiresAt: Date.now() + 60 * 60_000,
  }),
}));

import { FORK_ARTIFACTS_ENABLED_KEY, ForkArtifactsEnabled } from "./artifacts.logic";
import { ForkArtifactOpenButton } from "./ForkArtifactOpenButton";
import { ForkArtifactsPanel } from "./ForkArtifactsPanel";
import { useForkArtifactsStore } from "./forkArtifactsStore";

const threadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

function renderRow(input: {
  readonly id: string;
  readonly attachmentId: string;
  readonly title: string;
  readonly startedAt: string;
  readonly height?: number;
}): ThreadStructureVisibleTurnItem {
  return {
    sourceThreadId: threadRef.threadId,
    sourceItemId: input.id,
    item: {
      id: input.id,
      runId: "run-1",
      type: "dynamic_tool",
      status: "completed",
      toolName: "mcp__t3-code__html_render",
      startedAt: DateTime.makeUnsafe(input.startedAt),
      updatedAt: DateTime.makeUnsafe(input.startedAt),
      output: {
        htmlRender: {
          attachmentId: input.attachmentId,
          title: input.title,
          height: input.height ?? 320,
        },
      },
    },
  } as unknown as ThreadStructureVisibleTurnItem;
}

function setup(): Disposable {
  const reset = () => {
    mockTurnItems.current = [];
    mockAssetUrl.current = "about:blank";
    removeLocalStorageItem(FORK_ARTIFACTS_ENABLED_KEY);
    useForkArtifactsStore.setState({ selectedAttachmentIdByThreadKey: {} });
    useRightPanelStore.setState({ byThreadKey: {} });
  };
  reset();
  return { [Symbol.dispose]: reset };
}

describe("ForkArtifactsPanel", () => {
  it("shows an empty state when the thread has no renders", async () => {
    using _cleanup = setup();
    await using screen = await render(
      <ForkArtifactsPanel environmentId={threadRef.environmentId} threadRef={threadRef} />,
    );

    await expect.element(screen.getByText("No artifacts yet")).toBeVisible();
  });

  it("lists renders newest first and opens a clicked artifact inside the strict sandbox", async () => {
    using _cleanup = setup();
    mockTurnItems.current = [
      renderRow({
        id: "item-1",
        attachmentId: "att-old-html",
        title: "Old report",
        startedAt: "2026-11-24T09:00:00.000Z",
      }),
      renderRow({
        id: "item-2",
        attachmentId: "att-new-html",
        title: "Latest chart",
        startedAt: "2026-11-24T10:30:00.000Z",
      }),
    ];

    await using screen = await render(
      <ForkArtifactsPanel environmentId={threadRef.environmentId} threadRef={threadRef} />,
    );

    const buttons = [...screen.container.querySelectorAll("ul button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Latest chart"),
      expect.stringContaining("Old report"),
    ]);
    expect(buttons[0]?.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-11-24T10:30:00.000Z",
    );

    await userEvent.click(screen.getByRole("button", { name: /Latest chart/ }));

    const iframe = screen.getByTitle("Latest chart").element();
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");

    await userEvent.click(screen.getByRole("button", { name: "Back to artifacts" }));
    await expect.element(screen.getByRole("button", { name: /Old report/ })).toBeVisible();
  });

  it("shows a disabled notice when the setting is off and lets the user turn it back on", async () => {
    using _cleanup = setup();
    setLocalStorageItem(FORK_ARTIFACTS_ENABLED_KEY, false, ForkArtifactsEnabled);
    mockTurnItems.current = [
      renderRow({
        id: "item-1",
        attachmentId: "att-1-html",
        title: "Summary card",
        startedAt: "2026-11-24T10:00:00.000Z",
      }),
    ];

    await using screen = await render(
      <ForkArtifactsPanel environmentId={threadRef.environmentId} threadRef={threadRef} />,
    );

    await expect.element(screen.getByText("Artifacts panel is off")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await expect.element(screen.getByRole("button", { name: /Summary card/ })).toBeVisible();
  });

  it("opens the right panel directly to a specific artifact from ForkArtifactOpenButton", async () => {
    using _cleanup = setup();
    await using screen = await render(
      <ForkArtifactOpenButton threadRef={threadRef} attachmentId="att-new-html" />,
      { router: false },
    );

    await userEvent.click(screen.getByRole("button", { name: "Open in artifacts panel" }));

    const activeSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    );
    expect(activeSurface).toEqual({ id: "artifacts", kind: "artifacts" });
    expect(
      useForkArtifactsStore.getState().selectedAttachmentIdByThreadKey[
        `${threadRef.environmentId}:${threadRef.threadId}`
      ],
    ).toBe("att-new-html");
  });
});
