import {
  EnvironmentId,
  ForkTranscriptEditError,
  type ForkTranscriptBackup,
  type ForkTranscriptLoadResult,
  type ForkTranscriptRestoreInput,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { AppAtomRegistryProvider, appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import { emptyEditSession, forkTranscriptEditSessionAtom } from "./editSession";
import {
  ForkTranscriptBackupsDialogHost,
  openForkTranscriptBackups,
} from "./ForkTranscriptBackupsDialog";

const rpc = vi.hoisted(() => ({
  load: vi.fn<(input: unknown) => unknown>(),
  backups: vi.fn<(input: unknown) => unknown>(),
  restore: vi.fn<(input: unknown) => unknown>(),
  deleteBackup: vi.fn<(input: unknown) => unknown>(),
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
    forkTranscriptLoad: command("load", (input) => rpc.load(input)),
    forkTranscriptPreview: command("preview", () => null),
    forkTranscriptBlockText: command("blockText", () => ""),
    forkTranscriptSave: command("save", () => null),
    forkTranscriptBackups: command("backups", (input) => rpc.backups(input)),
    forkTranscriptRestore: command("restore", (input) => rpc.restore(input)),
    forkTranscriptDeleteBackup: command("deleteBackup", (input) => rpc.deleteBackup(input)),
  } as never;
});

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

const loadResult: ForkTranscriptLoadResult = {
  sessionId: "session-1",
  baseKey: "key-1",
  units: [],
  links: [],
  compactionItemId: null,
  validation: { errors: [], warnings: [] },
  live: { editable: true, reason: null, working: false },
};

const BACKUPS: ReadonlyArray<ForkTranscriptBackup> = [
  {
    name: "20261125T100200Z.jsonl",
    source: "t3",
    createdAt: "2026-11-25T10:02:00.000Z",
    size: 2048,
  },
  {
    name: "session-1.jsonl.20261101.bak",
    source: "legacy",
    createdAt: "2026-11-01T08:00:00.000Z",
    size: 1024,
  },
];

const SAVE_RESULT = {
  baseKey: "key-2",
  units: [],
  backup: "20261125T110000Z.jsonl",
  unmappedUnits: 0,
  inheritedUnits: 0,
  stoppedTurn: false,
};

const renderHost = async (pendingSteps: number) => {
  const threadId = `thread-${Math.random().toString(36).slice(2)}`;
  const threadKey = `environment-local:${threadId}`;
  const threadRef = { environmentId: ENVIRONMENT_ID, threadId: ThreadId.make(threadId) };
  appAtomRegistry.set(forkTranscriptEditSessionAtom(threadKey), {
    ...emptyEditSession,
    status: "ready",
    load: loadResult,
    history: {
      steps: Array.from({ length: pendingSteps }, (_, index) => ({
        id: `s${index}`,
        label: "Edited a message",
        unitKeys: ["u1"],
        items: [],
      })),
      redo: [],
    },
  });
  const screen = await render(
    <AppAtomRegistryProvider>
      <ForkTranscriptBackupsDialogHost
        threadKey={threadKey}
        threadRef={threadRef}
        timestampFormat="24-hour"
      />
    </AppAtomRegistryProvider>,
  );
  await act(async () => openForkTranscriptBackups(threadKey, threadRef));
  return Object.assign(screen, { threadKey });
};

describe("ForkTranscriptBackupsDialog", () => {
  const ready = () => {
    rpc.load.mockReset();
    rpc.backups.mockReset();
    rpc.restore.mockReset();
    rpc.deleteBackup.mockReset();
    rpc.load.mockReturnValue(loadResult);
    rpc.backups.mockReturnValue(BACKUPS);
  };

  it("lists each backup with its source", async () => {
    ready();
    await using _screen = await renderHost(0);
    const dialog = page.getByRole("dialog", { name: "Transcript backups" });
    await expect.element(dialog.getByText("20261125T100200Z.jsonl")).toBeVisible();
    await expect.element(dialog.getByText("Old editor")).toBeVisible();
    await expect.element(dialog.getByText("T3", { exact: true })).toBeVisible();
  });

  it("discards pending changes, then restores after the confirm", async () => {
    ready();
    rpc.restore.mockReturnValue(SAVE_RESULT);
    await using screen = await renderHost(2);
    const dialog = page.getByRole("dialog", { name: "Transcript backups" });
    await dialog.getByRole("button", { name: "Restore 20261125T100200Z.jsonl" }).click();
    const alert = page.getByRole("alertdialog");
    await expect
      .element(alert.getByText(/The current session file is backed up first/))
      .toBeVisible();
    await expect.element(alert.getByText(/2 pending changes are discarded/)).toBeVisible();
    await alert.getByRole("button", { name: "Restore" }).click();
    await expect.poll(() => rpc.restore.mock.calls.length).toBe(1);
    const input = rpc.restore.mock.calls[0]?.[0] as ForkTranscriptRestoreInput;
    expect(input).toMatchObject({
      backup: "20261125T100200Z.jsonl",
      source: "t3",
      baseKey: "key-1",
      confirmStop: false,
    });
    expect(
      appAtomRegistry.get(forkTranscriptEditSessionAtom(screen.threadKey)).history.steps,
    ).toHaveLength(0);
  });

  it("deletes a backup after the confirm and lists again", async () => {
    ready();
    rpc.deleteBackup.mockReturnValue(undefined);
    await using _screen = await renderHost(0);
    const dialog = page.getByRole("dialog", { name: "Transcript backups" });
    await dialog.getByRole("button", { name: "Delete session-1.jsonl.20261101.bak" }).click();
    const alert = page.getByRole("alertdialog");
    await expect.element(alert.getByText("Delete this backup?")).toBeVisible();
    await expect.element(alert.getByText("This cannot be undone.")).toBeVisible();
    await alert.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => rpc.deleteBackup.mock.calls.length).toBe(1);
    expect(rpc.deleteBackup.mock.calls[0]?.[0]).toMatchObject({
      backup: "session-1.jsonl.20261101.bak",
      source: "legacy",
    });
    await expect.poll(() => rpc.backups.mock.calls.length).toBe(2);
  });
});
