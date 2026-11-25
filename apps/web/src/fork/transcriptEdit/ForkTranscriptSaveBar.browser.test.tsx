import {
  EnvironmentId,
  ForkTranscriptEditError,
  type ForkTranscriptLoadResult,
  type ForkTranscriptPreviewResult,
  type ForkTranscriptSaveInput,
  type ForkTranscriptUnitView,
  ThreadId,
} from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { Atom } from "effect/reactivity";
import { createRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { ComposerBannerStack } from "~/components/chat/ComposerBannerStack";
import { toastManager } from "~/components/ui/toast";
import { AppAtomRegistryProvider, appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";
import { render } from "../../../test/render";
import { emptyEditSession, forkTranscriptEditSessionAtom } from "./editSession";
import {
  useForkTranscriptBannerItems,
  useForkTranscriptSendBlock,
} from "./forkTranscriptBannerItems";
import type { Step } from "./history.logic";

const rpc = vi.hoisted(() => ({
  preview: vi.fn<(input: unknown) => unknown>(),
  save: vi.fn<(input: unknown) => unknown>(),
}));

vi.mock(import("./transcriptEditRpc"), async () => {
  const Effect = await import("effect/Effect");
  const Schema = await import("effect/Schema");
  const isEditError = Schema.is(ForkTranscriptEditError);
  const command = (label: string, run: (input: unknown) => unknown) => ({
    label,
    run: (_registry: unknown, args: { readonly input: unknown }) =>
      Effect.suspend(() => {
        const value = run(args.input);
        return isEditError(value) ? Effect.fail(value) : Effect.succeed(value);
      }),
  });
  return {
    forkTranscriptLoad: command("load", () => null),
    forkTranscriptPreview: command("preview", (input) => rpc.preview(input)),
    forkTranscriptBlockText: command("blockText", () => ""),
    forkTranscriptSave: command("save", (input) => rpc.save(input)),
    forkTranscriptBackups: command("backups", () => []),
    forkTranscriptRestore: command("restore", () => null),
    forkTranscriptDeleteBackup: command("deleteBackup", () => undefined),
  } as never;
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-11-25T10:02:00.000Z";

const unit = (key: string, text: string): ForkTranscriptUnitView => ({
  key,
  kind: key.startsWith("u") ? "user" : "assistant",
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: CREATED_AT,
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: text,
});

const loadResult: ForkTranscriptLoadResult = {
  sessionId: "session-1",
  baseKey: "key-1",
  units: [unit("u1", "Fix the parser"), unit("a1", "reply one")],
  links: [],
  validation: { errors: [], warnings: [] },
  live: { editable: true, reason: null, working: false },
};

const step = (id: string, label: string, unitKey: string): Step => ({
  id,
  label,
  unitKeys: [unitKey],
  items: [
    {
      op: { kind: "editAssistantText", uuid: unitKey, block: 0, text: `${id} text` },
      at: CREATED_AT,
    },
  ],
});

const preview = (
  overrides: Partial<ForkTranscriptPreviewResult> = {},
): ForkTranscriptPreviewResult => ({
  units: loadResult.units,
  validation: { errors: [], warnings: [] },
  diff: [
    { key: "u1", kind: "user", status: "changed", before: "Fix the parser", after: "s1 text" },
    { key: "a1", kind: "assistant", status: "removed", before: "reply one", after: null },
  ],
  failedAt: null,
  ...overrides,
});

const SAVE_RESULT = {
  baseKey: "key-2",
  units: loadResult.units,
  backup: "20261125T100200Z.jsonl",
  unmappedUnits: 0,
  inheritedUnits: 0,
  stoppedTurn: false,
};

const mockThread = (runStatus: string | null) =>
  vi.spyOn(environmentThreadDetails, "threadAtom").mockReturnValue(
    Atom.make({
      projection: { runs: runStatus === null ? [] : [{ id: "run-1", status: runStatus }] },
    }) as never,
  );

function Harness(props: { readonly threadKey: string; readonly threadId: string }) {
  const items = useForkTranscriptBannerItems(
    props.threadKey,
    { environmentId: ENVIRONMENT_ID, threadId: ThreadId.make(props.threadId) },
    createRef<LegendListRef | null>(),
  );
  const sendBlock = useForkTranscriptSendBlock(props.threadKey);
  return (
    <>
      <ComposerBannerStack items={items} detached />
      <button type="button" disabled={sendBlock !== null} data-send-block={sendBlock ?? ""}>
        Send
      </button>
    </>
  );
}

const renderBar = async (input: {
  readonly steps: ReadonlyArray<Step>;
  readonly preview?: ForkTranscriptPreviewResult;
}) => {
  const threadId = `thread-${Math.random().toString(36).slice(2)}`;
  const threadKey = `environment-local:${threadId}`;
  appAtomRegistry.set(forkTranscriptEditSessionAtom(threadKey), {
    ...emptyEditSession,
    status: "ready",
    load: loadResult,
    history: { steps: input.steps, redo: [] },
    preview: input.preview ?? preview(),
  });
  const screen = await render(
    <AppAtomRegistryProvider>
      <Harness threadKey={threadKey} threadId={threadId} />
    </AppAtomRegistryProvider>,
  );
  return Object.assign(screen, { threadKey });
};

const session = (threadKey: string) =>
  appAtomRegistry.get(forkTranscriptEditSessionAtom(threadKey));

const TWO_STEPS = [step("s1", "Edited a message", "u1"), step("s2", "Removed a message", "a1")];

describe("ForkTranscriptSaveBar", () => {
  const ready = () => {
    rpc.preview.mockReset();
    rpc.save.mockReset();
    rpc.preview.mockReturnValue(preview());
  };

  it("shows the pending change count and blocks Send", async () => {
    ready();
    using _thread = mockThread(null);
    await using screen = await renderBar({ steps: TWO_STEPS });
    await expect.element(screen.getByRole("button", { name: "2 pending changes" })).toBeVisible();
    await expect.element(screen.getByText("Validation passed.")).toBeVisible();
    const send = screen.getByRole("button", { name: "Send" });
    await expect.element(send).toBeDisabled();
    await expect
      .element(send)
      .toHaveAttribute(
        "data-send-block",
        "Save or discard the transcript changes to send a message.",
      );
  });

  it("reverts one step from the changes popover and keeps the other", async () => {
    ready();
    using _thread = mockThread(null);
    await using screen = await renderBar({ steps: TWO_STEPS });
    await screen.getByRole("button", { name: "2 pending changes" }).click();
    await expect.element(page.getByText("Fix the parser")).toBeVisible();
    await page.getByRole("button", { name: "Revert: Edited a message" }).click();
    await expect
      .poll(() => session(screen.threadKey).history.steps.map((s) => s.id))
      .toEqual(["s2"]);
  });

  it("disables Save while validation errors exist", async () => {
    ready();
    using _thread = mockThread(null);
    await using screen = await renderBar({
      steps: TWO_STEPS,
      preview: preview({
        validation: {
          errors: [{ code: "broken-chain", message: "The chain breaks at a1." }],
          warnings: [],
        },
      }),
    });
    await expect.element(screen.getByRole("button", { name: "1 error" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("lists every change with its status in the review dialog", async () => {
    ready();
    using _thread = mockThread(null);
    await using screen = await renderBar({ steps: TWO_STEPS });
    await screen.getByRole("button", { name: "Review changes" }).click();
    const dialog = page.getByRole("dialog", { name: "Review changes" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText("2 changes")).toBeVisible();
    await expect.element(dialog.getByText("Edited", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("Removed", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("reply one")).toBeVisible();
  });

  it("repeats the save with confirmStop after a busy refusal", async () => {
    ready();
    using _thread = mockThread("running");
    rpc.save.mockReturnValueOnce(
      new ForkTranscriptEditError({ code: "busy", detail: "The thread is working now." }),
    );
    rpc.save.mockReturnValueOnce(SAVE_RESULT);
    await using screen = await renderBar({ steps: TWO_STEPS });
    await screen.getByRole("button", { name: "Save" }).click();
    const alert = page.getByRole("alertdialog");
    await expect.element(alert.getByText("The thread is working now.")).toBeVisible();
    await alert.getByRole("button", { name: "Stop and save" }).click();
    await expect.poll(() => rpc.save.mock.calls.length).toBe(2);
    const [first, second] = rpc.save.mock.calls.map(([input]) => input as ForkTranscriptSaveInput);
    expect(first?.confirmStop).toBe(false);
    expect(second?.confirmStop).toBe(true);
    expect(second?.after).toBe("continue");
    expect(second?.ops).toHaveLength(2);
  });

  it("shows the toast and hides the bar after a save", async () => {
    ready();
    using _thread = mockThread(null);
    const toast = vi.spyOn(toastManager, "add");
    rpc.save.mockReturnValueOnce({ ...SAVE_RESULT, inheritedUnits: 1 });
    await using screen = await renderBar({ steps: TWO_STEPS });
    await screen.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => toast.mock.calls.length).toBe(1);
    expect(toast.mock.calls[0]?.[0]).toMatchObject({
      type: "success",
      title: "Saved. Claude sees the edited history on the next message.",
      description: "1 message from the parent thread kept their old text in the timeline.",
    });
    await expect.poll(() => session(screen.threadKey).history.steps.length).toBe(0);
    await expect
      .element(screen.getByRole("button", { name: "2 pending changes" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    toast.mockRestore();
  });

  it("shows the real reason of a writeFailed refusal", async () => {
    ready();
    using _thread = mockThread(null);
    rpc.save.mockReturnValueOnce(
      new ForkTranscriptEditError({
        code: "writeFailed",
        detail: "The session file cannot be written. Backup 20261125T100200Z.jsonl holds it.",
      }),
    );
    await using screen = await renderBar({ steps: TWO_STEPS });
    await screen.getByRole("button", { name: "Save" }).click();
    const alert = page.getByRole("alertdialog");
    await expect.element(alert.getByText("The save did not finish")).toBeVisible();
    await expect.element(alert.getByText(/20261125T100200Z\.jsonl/)).toBeVisible();
    expect(session(screen.threadKey).history.steps).toHaveLength(2);
  });
});
