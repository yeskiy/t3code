import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProviderInstanceId, ScopedThreadRef } from "@t3tools/contracts";

import type { ForkTranscriptMenuId, ForkTranscriptMenuState } from "./threadMenu.logic";
import { readForkTranscriptEditEnabled } from "./transcriptEditSetting";
import { readForkTranscriptDriver, readForkTranscriptSelectMode } from "./transcriptEditShortcuts";

/** The menu state of a Claude thread with the setting on, or null to hide the items. */
export const readForkTranscriptMenuState = (
  threadRef: ScopedThreadRef,
  providerInstanceId: ProviderInstanceId,
): ForkTranscriptMenuState | null => {
  if (!readForkTranscriptEditEnabled()) return null;
  const driver = readForkTranscriptDriver(threadRef.environmentId, providerInstanceId);
  if (driver !== null && driver !== "claudeAgent") return null;
  return { selectMode: readForkTranscriptSelectMode(scopedThreadKey(threadRef)) };
};

export const isForkTranscriptMenuAction = (action: string): action is ForkTranscriptMenuId =>
  action === "fork-transcript-select" || action === "fork-transcript-backups";

// The thread opens first, because the dialog and the Select mode live in the thread view.
// The imports are lazy, so the thread menu does not load the edit UI.
export const runForkTranscriptMenuAction = async (
  action: ForkTranscriptMenuId,
  threadRef: ScopedThreadRef,
  openThread: () => Promise<unknown>,
): Promise<void> => {
  await openThread();
  const threadKey = scopedThreadKey(threadRef);
  if (action === "fork-transcript-backups") {
    const { openForkTranscriptBackups } = await import("./ForkTranscriptBackupsDialog");
    await openForkTranscriptBackups(threadKey, threadRef);
    return;
  }
  const [{ toggleForkTranscriptSelectMode }, { appAtomRegistry }] = await Promise.all([
    import("./transcriptEditCommands"),
    import("~/rpc/atomRegistry"),
  ]);
  await toggleForkTranscriptSelectMode(appAtomRegistry, threadKey, threadRef);
};
