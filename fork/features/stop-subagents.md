# Stop Keeps Subagents and Background Work Alive

## Problem

Pressing Stop in a Claude thread ended the current turn and killed every running subagent, background command, delegated task, and pull request watch on that thread. In `ClaudeAdapterV2.ts`, `interruptTurn` called `query.interrupt()` and then `query.close()`, which terminated the Claude Code process and every task inside it. The orchestrator also ended pull request watches, disposed delegated task wakes, and emitted `delegated-tasks.stop`.

## Upstream status

- Issue [#38068](https://github.com/pingdotgg/t3code/issues/38068) (closed as not planned) diagnosed `interruptTurn` calling `query.interrupt()` then `query.close()`.
- Discussion [#16759](https://github.com/pingdotgg/t3code/discussions/16759) proposed turn-scoped Stop.
- PR [#16852](https://github.com/pingdotgg/t3code/pull/16852) by Nikita Koynov (`nkoynov`) implemented turn-scoped Stop across the orchestrator, contracts, client runtime, web UI, OpenCode 2, and Claude. It was closed on 2026-10-14 due to PR size (1,682 lines across 26 files), not technical rejection.
- Upstream `main` and nightly `0.1.12-nightly.20261123.5165` still close the Claude query on every Stop.

## Design

This fork ports PR #16852 for the shared stop-scope pipeline and Claude, adapted to `thread.stop` and Force stop on current `main`, with foreground subagent backgrounding before interrupt.

- **Contracts (`packages/contracts/src/orchestrationV2.ts`, `packages/provider-core/src/server/ProviderAdapter.ts`):**
  - `OrchestrationV2TurnCapabilities` gains optional `interruptKeepsBackgroundWork`.
  - `thread.stop` and `run.interrupt` accept optional `scope: "turn" | "all"`. Omitted means `"all"`, so older clients, mobile, `task_cancel`, Force stop, and the Waiting strip Stop keep full-stop behavior.
  - `thread.background-work.settle` and `provider-turn.interrupt` carry optional `scope: "turn"`.
  - `ProviderAdapterV2InterruptInput` gains `keepBackgroundWork?: boolean`.
  - `turn.terminal` (non-failed) gains `backgroundWorkContinues?: boolean`.
- **Web and client runtime (`apps/web/src/components/ChatView.tsx`, `apps/web/src/components/chat/ComposerPrimaryActions.tsx`, `apps/web/src/components/chat/useThreadLifecycle.tsx`, `apps/web/src/fork/stopScope/`, `packages/client-runtime/src/operations/commands.ts`):**
  - When a turn is running, the composer Stop button and `thread.stop` shortcut send `scope: "turn"` directly with no confirmation dialog.
  - When no turn is running and background work is still running, the composer Stop button and `thread.stop` shortcut open a confirmation dialog (`Stop background work?`) listing the running background counts (commands, subagents, delegated tasks, monitors, pull request watches, and background tasks) with `Cancel` (default focus, sends nothing) and destructive `Stop all` (runs the same full stop as the Waiting strip Stop).
  - Composer Stop tooltip and `aria-label` reflect the current state: `Stop turn` when only a turn runs, `Stop turn (background work keeps running)` when both a turn and background work run, and `Stop background work` when only background work runs.
  - The Waiting strip Stop button (`useThreadLifecycle.tsx`) sends no scope, so it stops all remaining background work and closes the Claude process.
- **Orchestrator and run execution (`apps/server/src/fork/ForkStopScope.ts`, `Orchestrator.ts`, `ProviderTurnControlService.ts`, `EffectOutbox.ts`, `EffectWorker.ts`, `RunExecutionService.ts`):**
  - On an active run (`preparing`, `starting`, `running`), `scope: "turn"` holds the queue and interrupts only the active turn. It keeps pull request watches, delegated tasks, delegated completion wakes, and background work on other provider threads.
  - On a settled run, `scope: "turn"` falls back to a full Stop.
  - When a provider declares `interruptKeepsBackgroundWork: true`, `ProviderTurnControlService` sends `keepBackgroundWork: true` instead of `requestRuntimeRestart: true`.
  - When the provider emits `turn.terminal` with `status: "interrupted"` and `backgroundWorkContinues: true`, `RunExecutionService` skips cascading run-owned subagents to `interrupted`, keeps ingesting late updates until the work finishes, and prevents a newer run from inheriting those items.
  - `thread.background-work.settle` checks `hasPendingBackgroundWorkForThread(providerThread, { includeSubagents: true })` so both background commands and live subagents stay open, while dead sessions or timed-out fallback closes still settle leftover items.
- **Claude adapter (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`):**
  - Declares `interruptKeepsBackgroundWork: true` and passes `perTaskStopAffordance: true` in `makeClaudeQueryOptions` so Claude Code's `initialize` state spares running background agents and workflows on turn interrupts.
  - On `keepBackgroundWork: true`: backgrounds running root foreground subagents via `query.backgroundTasks(toolUseId)` (skipping tasks already in `backgroundedSubagentTaskIds`), then sends `{ subtype: "interrupt", spare_background_tasks: true }` without `query.close()` (falling back to `query.interrupt()` when the SDK query runtime has no `request` method).
  - Waits up to 10 seconds for `currentTurn.ended`. If Claude ends the turn, the CLI process stays alive, `backgroundWorkContinues: true` is emitted, and `settledTurnByNativeThread` stays set so surviving work reports normally and individual subagents can still be stopped via `stopSubagent`.
  - If Claude does not end the turn within 10 seconds, the adapter clears the turn-scoped marker and falls back to `query.close()`. If `close()` also times out, it fails with `ProviderAdapterInterruptTimeoutError` so the UI offers **Force stop**.
  - If the CLI exits before settlement or a full Stop arrives mid-wait, the turn-scoped marker is cleared so no dead background work is reported as continuing.

## What the user and model see after Stop

### What the user sees

- The active turn ends with status `Interrupted` (`Stopped by user`). Any foreground tool call cut short by the interrupt shows as `interrupted`, not `failed`.
- Queued messages stay held until resumed.
- Surviving background commands, delegated tasks, pull request watches, and surviving native subagents remain listed in the **Running / Waiting** strip above the composer.
- The strip's **Stop** button is immediately active and stops all remaining background work (and closes the Claude process).
- If the CLI hangs and ignores Stop, the **Force stop** banner appears as before.
- Sending a follow-up message reuses the live Claude session without killing background commands or subagents.

### What the model sees

- The interrupted foreground tool receives a user-rejected tool result and `[Request interrupted by user for tool use]`, and the turn settles with `error_during_execution` (`terminal_reason: "aborted_tools"` or `"aborted_streaming"`).
- When a surviving background command or subagent finishes later, Claude Code emits `task_notification` and starts a wake turn with its result.

## SDK and CLI behavior

In `@anthropic-ai/claude-agent-sdk` `0.3.321` (tested with Claude Code `2.1.331`), Claude Code fails closed on a plain `interrupt` unless the client declares `perTaskStopAffordance: true` at `initialize` or sends `spare_background_tasks: true` on the `interrupt` control request. T3 Code sets both: `perTaskStopAffordance: true` in `makeClaudeQueryOptions` and `spare_background_tasks: true` on turn-scoped interrupts (while full Stop still sends a plain `interrupt` followed by `query.close()`).

- **Background Bash/PowerShell commands** survive turn-scoped Stop, stay on the Waiting strip, and wake the thread on completion.
- **Claude native subagents (`Agent` tool) and workflows** survive turn-scoped Stop on Claude Code builds that honor `perTaskStopAffordance` or `spare_background_tasks` (including `2.1.331`), stay stoppable individually via `stop_task`, and wake the thread on completion. Older Claude Code CLIs that ignore both flags still fail closed and emit `task_notification` `status: "stopped"`, which T3 renders accurately as cancelled.
- **T3 delegated tasks (`delegate_task`)** and **pull request watches** survive composer Stop completely and wake the thread on completion.
- If you want to detach a single foreground Bash/PowerShell call or subagent without ending the turn, use **Move to background** (`Ctrl+B`) instead of Stop.
