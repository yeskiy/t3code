import { FORK_TRANSCRIPT_EDIT_WS_METHODS } from "@t3tools/contracts";

import type { ForkTranscriptEdit } from "./ForkTranscriptEdit.ts";

/** RPC handlers for the transcript editor. */
export const forkTranscriptEditRpcHandlers = (edit: ForkTranscriptEdit["Service"]) => ({
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.load]: edit.load,
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.preview]: edit.preview,
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.save]: edit.save,
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.backups]: edit.backups,
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.restore]: edit.restore,
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.deleteBackup]: edit.deleteBackup,
  [FORK_TRANSCRIPT_EDIT_WS_METHODS.blockText]: edit.blockText,
});
