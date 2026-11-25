import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { FORK_TRANSCRIPT_EDIT_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "~/connection/runtime";

export const forkTranscriptLoad = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:load",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.load,
});

export const forkTranscriptPreview = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:preview",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.preview,
});

export const forkTranscriptSave = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:save",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.save,
});

export const forkTranscriptBackups = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:backups",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.backups,
});

export const forkTranscriptRestore = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:restore",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.restore,
});

export const forkTranscriptDeleteBackup = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:delete-backup",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.deleteBackup,
});

export const forkTranscriptBlockText = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:fork:transcript-edit:block-text",
  tag: FORK_TRANSCRIPT_EDIT_WS_METHODS.blockText,
});
