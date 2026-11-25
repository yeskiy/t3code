# Rewind Fixes ("Edit from here" after failed and stopped runs)

Fixes for conversation rewind after failed runs, stopped turns without replies, and rollback failure reporting.

## Parts

### Part A: Prompt uuid cursor for started Claude turns without a reply

Port of upstream PR `pingdotgg/t3code#41126`. When a Claude turn ends without an assistant message cursor, `claudeTranscriptCursor` records the prompt uuid if Claude started the prompt, the turn sent no steers, and the turn is not a resume. That lets a later rewind pin the prompt uuid and clears a pinned rollback head once the turn wrote to the transcript.

### Part B: Opt-in earlier-cursor fallback

When a rewind target turn has no real Claude cursor (for example, an older failed run or a turn stopped before its prompt started), `nearestEarlierClaudeCursor` finds the newest earlier turn of the same provider thread that has a real cursor.

- **Opt-in field:** `forkEarlierCursorFallback?: true` on `ProviderAdapterV2RollbackThreadInput`.
- `CheckpointRollbackService` sets `forkEarlierCursorFallback: true`.
- Adapter tests that call `rollbackThread` without the flag keep the upstream error behavior required by the upstream adapter test.
- **Dropped prompts:** the fallback drops the target turn and any turns without a real cursor between that earlier cursor and the target from Claude's history. T3 keeps those prompts visible in the timeline and logs `providerThreadId` and `droppedTurns`.

### Part C: Capture checkpoints for failed runs

`forkRunCapturesCheckpoint` includes `failed` alongside `completed`, `interrupted`, and `cancelled` in both `RunExecutionService` and `CheckpointCaptureService`. Failed runs now capture a checkpoint so the next user message keeps "Edit from here".

### Part D: Real rollback failure reason

`forkRollbackFailureClientMessage` maps known `CheckpointRollbackExecutionError` reasons (`rollback-target-invalid`, `active-provider-changed`, `provider-turn-unavailable`, `shared-workspace`, `ProviderAdapterRollbackThreadError`, and other unexpected failure tags) to plain messages while keeping the upstream message for a held Git index lock and raw Git output.

- Provided in production through `ForkRollbackFailureClientMessage` (`Context.Reference` defaulting to upstream `rollbackFailureClientMessage`), wired by `layerForkRollbackFailureClientMessage` in `RuntimeLayer.layerProduction`.
- Keeping the upstream default keeps `runtimeLayer.test.ts` ("projects a rollback that fails every attempt and clears it on the next one") green without editing the upstream test.

### Part E: Dropped prompts count and web toast

- `ProviderAdapterV2ThreadSnapshot` carries an optional `forkDroppedPrompts?: number` field set by `ClaudeAdapterV2.rollbackThread` when the Part B fallback runs.
- `OrchestrationV2AppThread` carries an optional `forkRollbackDroppedPrompts: { requestId, count } | null` field, cleared on a new rollback in `Orchestrator` and written by `CheckpointRollbackService` on `thread.metadata-updated`.
- After `waitForRevertedMessage` finishes in `chatViewSend.ts`, `droppedPromptsNotice.ts` shows a warning toast: `"Claude no longer sees N stopped prompts before this point."` (singular for 1).

### Part F: One-time failed-run checkpoint backfill

`backfillFailedRunCheckpoints` runs once per database at server start (`server.ts`). It scans `orchestration_v2_projection_runs` for `status = 'failed'` rows with no checkpoint, writes an event-sourced conversation-only (`status: "missing"`) checkpoint and `run.updated` event for each eligible run, logs `{ filled }`, and records completion in the `fork_backfill_markers` table (`name = 'failed-run-checkpoints-v1'`).

- Uses a small fork marker table inside SQLite instead of a settings key so the marker stays strictly per database without changing upstream settings schemas or adding a numbered persistence migration.
- Idempotent even if re-run without the marker, and never touches `completed`, `interrupted`, or `cancelled` runs.

### Part G: Retry a restore while the index is locked

A rewind can recreate a removed worktree. Its background index swap holds `index.lock` for about 1 ms. `VcsProcess.run` retries a `restoreCheckpoint` Git command 2 times, 75 ms apart, only on `GIT_INDEX_LOCKED_DETAIL`.

## Hook points

| Upstream file                                                       | Hook                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/provider-core/src/server/ProviderAdapter.ts`              | `forkEarlierCursorFallback` on rollback input and `forkDroppedPrompts` on thread snapshot  |
| `packages/contracts/src/orchestrationV2.ts`                         | `forkRollbackDroppedPrompts` on `OrchestrationV2AppThread`                                 |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`      | Part A `claudeTranscriptCursor`; Part B/E earlier-cursor fallback and `forkDroppedPrompts` |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` | Part A PR tests and Part B opt-in fallback test                                            |
| `apps/server/src/orchestration-v2/CheckpointRollbackService.ts`     | Pass `forkEarlierCursorFallback: true` and project `forkRollbackDroppedPrompts`            |
| `apps/server/src/orchestration-v2/Orchestrator.ts`                  | Clear `forkRollbackDroppedPrompts` on a new rollback request                               |
| `apps/server/src/orchestration-v2/RunExecutionService.ts`           | Call `forkRunCapturesCheckpoint` on terminal run status                                    |
| `apps/server/src/orchestration-v2/CheckpointCaptureService.ts`      | Call `forkRunCapturesCheckpoint` for settled runs                                          |
| `apps/server/src/orchestration-v2/EffectWorker.ts`                  | Read `ForkRollbackFailureClientMessage` for rollback failure messages                      |
| `apps/server/src/orchestration-v2/runtimeLayer.ts`                  | Provide `layerForkRollbackFailureClientMessage` in `layerProduction`                       |
| `apps/server/src/server.ts`                                         | Run `backfillFailedRunCheckpointsOnStartup` once at startup                                |
| `apps/web/src/components/chat/chatViewSend.ts`                      | Show the dropped-prompts toast after rewind completes                                      |
| `apps/server/src/vcs/VcsProcess.ts`                                 | Part G: retry a checkpoint restore while a worktree index swap holds `index.lock`          |

## Turn off

| Part   | How to turn off                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Part A | Remove `claudeTranscriptCursor` calls in `ClaudeAdapterV2.ts` (or drop once upstream merges PR #41126)                                |
| Part B | Remove `forkEarlierCursorFallback: true` from `CheckpointRollbackService.ts`                                                          |
| Part C | Restore the three-status check in `RunExecutionService.ts` and `CheckpointCaptureService.ts`                                          |
| Part D | Remove `Layer.provide(layerForkRollbackFailureClientMessage)` from `runtimeLayer.ts`                                                  |
| Part E | Remove `notifyForkRollbackDroppedPrompts` from `chatViewSend.ts` and `forkRollbackDroppedPrompts` from `CheckpointRollbackService.ts` |
| Part F | Remove `backfillFailedRunCheckpointsOnStartup` from `server.ts`                                                                       |
| Part G | Remove the `restoreCheckpoint` retry branch from `VcsProcess.run` in `VcsProcess.ts`                                                  |
