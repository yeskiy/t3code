import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { NonNegativeInt, ThreadId } from "./baseSchemas.ts";

export const FORK_TRANSCRIPT_EDIT_WS_METHODS = {
  load: "fork.transcriptEdit.load",
  preview: "fork.transcriptEdit.preview",
  save: "fork.transcriptEdit.save",
  backups: "fork.transcriptEdit.backups",
  restore: "fork.transcriptEdit.restore",
  deleteBackup: "fork.transcriptEdit.deleteBackup",
  blockText: "fork.transcriptEdit.blockText",
} as const;

const FORK_TRANSCRIPT_MAX_OPS = 10_000;

const Role = Schema.Literals(["user", "assistant"]);

export const ForkTranscriptOp = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("editUserText"),
    uuid: Schema.String,
    block: Schema.NullOr(NonNegativeInt),
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("editAssistantText"),
    uuid: Schema.String,
    block: NonNegativeInt,
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("editSystemContent"),
    uuid: Schema.String,
    content: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("removeThinking"),
    target: Schema.Union([
      Schema.Literal("all"),
      Schema.Struct({ uuid: Schema.String, block: NonNegativeInt }),
    ]),
  }),
  Schema.Struct({ kind: Schema.Literal("deleteUnit"), unit: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("deleteUnits"), units: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("moveUnit"), unit: Schema.String, toIndex: NonNegativeInt }),
  Schema.Struct({
    kind: Schema.Literal("insertMessage"),
    role: Role,
    text: Schema.String,
    index: NonNegativeInt,
    uuid: Schema.String,
    timestamp: Schema.String,
    messageId: Schema.NullOr(Schema.String),
  }),
]);
export type ForkTranscriptOp = typeof ForkTranscriptOp.Type;

export const ForkTranscriptPendingOp = Schema.Struct({ op: ForkTranscriptOp, at: Schema.String });
export type ForkTranscriptPendingOp = typeof ForkTranscriptPendingOp.Type;

const Ops = Schema.Array(ForkTranscriptPendingOp).check(
  Schema.isMaxLength(FORK_TRANSCRIPT_MAX_OPS),
);

export const ForkTranscriptUnitKind = Schema.Literals([
  "preamble",
  "user",
  "assistant",
  "tool",
  "system",
]);
export type ForkTranscriptUnitKind = typeof ForkTranscriptUnitKind.Type;

export const ForkTranscriptViewBlock = Schema.Struct({
  uuid: Schema.String,
  index: Schema.NullOr(NonNegativeInt),
  type: Schema.Literals([
    "text",
    "thinking",
    "redacted_thinking",
    "tool_use",
    "tool_result",
    "system",
    "image",
    "other",
  ]),
  text: Schema.String,
  truncated: Schema.Boolean,
  editable: Schema.Boolean,
  removable: Schema.Boolean,
  name: Schema.optional(Schema.String),
  isError: Schema.optional(Schema.Boolean),
});
export type ForkTranscriptViewBlock = typeof ForkTranscriptViewBlock.Type;

export const ForkTranscriptEntryView = Schema.Struct({
  uuid: Schema.String,
  parentUuid: Schema.NullOr(Schema.String),
  type: Schema.String,
  timestamp: Schema.NullOr(Schema.String),
  messageId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  raw: Schema.String,
  rawTruncated: Schema.Boolean,
});
export type ForkTranscriptEntryView = typeof ForkTranscriptEntryView.Type;

export const ForkTranscriptUnitView = Schema.Struct({
  key: Schema.String,
  kind: ForkTranscriptUnitKind,
  subtype: Schema.NullOr(Schema.String),
  locked: Schema.Boolean,
  meta: Schema.Boolean,
  compactSummary: Schema.Boolean,
  time: Schema.NullOr(Schema.String),
  blocks: Schema.Array(ForkTranscriptViewBlock),
  entries: Schema.Array(ForkTranscriptEntryView),
  hidden: Schema.Array(
    Schema.Struct({ uuid: Schema.String, type: Schema.String, detail: Schema.String }),
  ),
  excerpt: Schema.String,
});
export type ForkTranscriptUnitView = typeof ForkTranscriptUnitView.Type;

const Issue = Schema.Struct({
  code: Schema.Literals([
    "duplicate-uuid",
    "missing-leaf",
    "broken-chain",
    "unanswered-tool-use",
    "orphan-tool-result",
    "thinking-modified",
  ]),
  message: Schema.String,
  uuid: Schema.optional(Schema.String),
});
export const ForkTranscriptValidation = Schema.Struct({
  errors: Schema.Array(Issue),
  warnings: Schema.Array(Issue),
});
export type ForkTranscriptValidation = typeof ForkTranscriptValidation.Type;

export const ForkTranscriptDiffItem = Schema.Struct({
  key: Schema.String,
  kind: ForkTranscriptUnitKind,
  status: Schema.Literals(["added", "removed", "changed", "moved", "movedChanged"]),
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
});
export type ForkTranscriptDiffItem = typeof ForkTranscriptDiffItem.Type;

export const ForkTranscriptLive = Schema.Struct({
  editable: Schema.Boolean,
  reason: Schema.NullOr(Schema.Literals(["not-claude", "no-session-file", "working"])),
  working: Schema.Boolean,
});
export type ForkTranscriptLive = typeof ForkTranscriptLive.Type;

export const ForkTranscriptBackup = Schema.Struct({
  name: Schema.String,
  source: Schema.Literals(["t3", "legacy"]),
  createdAt: Schema.String,
  size: NonNegativeInt,
});
export type ForkTranscriptBackup = typeof ForkTranscriptBackup.Type;

// Links a T3 turn item to the file unit it maps to. Inherited marks a parent-thread item.
export const ForkTranscriptItemLink = Schema.Struct({
  itemId: Schema.String,
  unitKey: Schema.String,
  inherited: Schema.Boolean,
});
export type ForkTranscriptItemLink = typeof ForkTranscriptItemLink.Type;

export const ForkTranscriptLoadInput = Schema.Struct({ threadId: ThreadId });
export type ForkTranscriptLoadInput = typeof ForkTranscriptLoadInput.Type;

export const ForkTranscriptLoadResult = Schema.Struct({
  sessionId: Schema.String,
  baseKey: Schema.String,
  units: Schema.Array(ForkTranscriptUnitView),
  links: Schema.Array(ForkTranscriptItemLink),
  // The T3 compaction item of the last compaction on the active path. Items before it are locked.
  compactionItemId: Schema.NullOr(Schema.String),
  validation: ForkTranscriptValidation,
  live: ForkTranscriptLive,
});
export type ForkTranscriptLoadResult = typeof ForkTranscriptLoadResult.Type;

export const ForkTranscriptPreviewInput = Schema.Struct({
  threadId: ThreadId,
  baseKey: Schema.String,
  ops: Ops,
});
export type ForkTranscriptPreviewInput = typeof ForkTranscriptPreviewInput.Type;

export const ForkTranscriptPreviewResult = Schema.Struct({
  units: Schema.Array(ForkTranscriptUnitView),
  validation: ForkTranscriptValidation,
  diff: Schema.Array(ForkTranscriptDiffItem),
  failedAt: Schema.NullOr(Schema.Struct({ index: NonNegativeInt, message: Schema.String })),
});
export type ForkTranscriptPreviewResult = typeof ForkTranscriptPreviewResult.Type;

export const ForkTranscriptSaveInput = Schema.Struct({
  threadId: ThreadId,
  baseKey: Schema.String,
  ops: Ops,
  confirmStop: Schema.Boolean,
  after: Schema.Literals(["idle", "continue"]),
});
export type ForkTranscriptSaveInput = typeof ForkTranscriptSaveInput.Type;

export const ForkTranscriptSaveResult = Schema.Struct({
  baseKey: Schema.String,
  units: Schema.Array(ForkTranscriptUnitView),
  backup: Schema.String,
  unmappedUnits: NonNegativeInt,
  inheritedUnits: NonNegativeInt,
  stoppedTurn: Schema.Boolean,
});
export type ForkTranscriptSaveResult = typeof ForkTranscriptSaveResult.Type;

export const ForkTranscriptBackupsInput = Schema.Struct({ threadId: ThreadId });
export type ForkTranscriptBackupsInput = typeof ForkTranscriptBackupsInput.Type;

export const ForkTranscriptRestoreInput = Schema.Struct({
  threadId: ThreadId,
  baseKey: Schema.String,
  backup: Schema.String,
  source: Schema.Literals(["t3", "legacy"]),
  confirmStop: Schema.Boolean,
});
export type ForkTranscriptRestoreInput = typeof ForkTranscriptRestoreInput.Type;

export const ForkTranscriptDeleteBackupInput = Schema.Struct({
  threadId: ThreadId,
  backup: Schema.String,
  source: Schema.Literals(["t3", "legacy"]),
});
export type ForkTranscriptDeleteBackupInput = typeof ForkTranscriptDeleteBackupInput.Type;

export const ForkTranscriptBlockTextInput = Schema.Struct({
  threadId: ThreadId,
  baseKey: Schema.String,
  uuid: Schema.String,
  index: Schema.NullOr(NonNegativeInt),
  part: Schema.Literals(["block", "raw"]),
});
export type ForkTranscriptBlockTextInput = typeof ForkTranscriptBlockTextInput.Type;

export class ForkTranscriptEditError extends Schema.TaggedError<ForkTranscriptEditError>()(
  "ForkTranscriptEditError",
  {
    code: Schema.Literals([
      "not-claude",
      "no-session-file",
      "busy",
      "stopFailed",
      "stale",
      "invalid",
      "changed",
      "writeFailed",
      "badBackup",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const error = Schema.Union([ForkTranscriptEditError, EnvironmentAuthorizationError]);

export const WsForkTranscriptLoadRpc = Rpc.make(FORK_TRANSCRIPT_EDIT_WS_METHODS.load, {
  payload: ForkTranscriptLoadInput,
  success: ForkTranscriptLoadResult,
  error,
});
export const WsForkTranscriptPreviewRpc = Rpc.make(FORK_TRANSCRIPT_EDIT_WS_METHODS.preview, {
  payload: ForkTranscriptPreviewInput,
  success: ForkTranscriptPreviewResult,
  error,
});
export const WsForkTranscriptSaveRpc = Rpc.make(FORK_TRANSCRIPT_EDIT_WS_METHODS.save, {
  payload: ForkTranscriptSaveInput,
  success: ForkTranscriptSaveResult,
  error,
});
export const WsForkTranscriptBackupsRpc = Rpc.make(FORK_TRANSCRIPT_EDIT_WS_METHODS.backups, {
  payload: ForkTranscriptBackupsInput,
  success: Schema.Array(ForkTranscriptBackup),
  error,
});
export const WsForkTranscriptRestoreRpc = Rpc.make(FORK_TRANSCRIPT_EDIT_WS_METHODS.restore, {
  payload: ForkTranscriptRestoreInput,
  success: ForkTranscriptSaveResult,
  error,
});
export const WsForkTranscriptDeleteBackupRpc = Rpc.make(
  FORK_TRANSCRIPT_EDIT_WS_METHODS.deleteBackup,
  {
    payload: ForkTranscriptDeleteBackupInput,
    success: Schema.Void,
    error,
  },
);
export const WsForkTranscriptBlockTextRpc = Rpc.make(FORK_TRANSCRIPT_EDIT_WS_METHODS.blockText, {
  payload: ForkTranscriptBlockTextInput,
  success: Schema.String,
  error,
});

export const FORK_TRANSCRIPT_EDIT_RPCS = [
  WsForkTranscriptLoadRpc,
  WsForkTranscriptPreviewRpc,
  WsForkTranscriptSaveRpc,
  WsForkTranscriptBackupsRpc,
  WsForkTranscriptRestoreRpc,
  WsForkTranscriptDeleteBackupRpc,
  WsForkTranscriptBlockTextRpc,
] as const;
