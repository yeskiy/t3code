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
- **Web and client runtime (`apps/web/src/components/ChatView.tsx`, `packages/client-runtime/src/operations/commands.ts`):**
  - The composer Stop button and `thread.stop` shortcut send `scope: "turn"`.
  - The Waiting strip Stop button (`useThreadLifecycle.tsx`) sends no scope, so it stops all remaining background work and closes the Claude process.
- **Orchestrator and run execution (`apps/server/src/fork/ForkStopScope.ts`, `Orchestrator.ts`, `ProviderTurnControlService.ts`, `EffectOutbox.ts`, `EffectWorker.ts`, `RunExecutionService.ts`):**
  - On an active run (`preparing`, `starting`, `running`), `scope: "turn"` holds the queue and interrupts only the active turn. It keeps pull request watches, delegated tasks, delegated completion wakes, and background work on other provider threads.
  - On a settled run, `scope: "turn"` falls back to a full Stop.
  - When a provider declares `interruptKeepsBackgroundWork: true`, `ProviderTurnControlService` sends `keepBackgroundWork: true` instead of `requestRuntimeRestart: true`.
  - When the provider emits `turn.terminal` with `status: "interrupted"` and `backgroundWorkContinues: true`, `RunExecutionService` skips cascading run-owned subagents to `interrupted`, keeps ingesting late updates until the work finishes, and prevents a newer run from inheriting those items.
  - `thread.background-work.settle` checks `hasPendingBackgroundWorkForThread(providerThread, { includeSubagents: true })` so both background commands and live subagents stay open, while dead sessions or timed-out fallback closes still settle leftover items.
- **Claude adapter (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`):**
  - Declares `interruptKeepsBackgroundWork: true`.
  - On `keepBackgroundWork: true`: backgrounds running root foreground subagents via `query.backgroundTasks(toolUseId)` (skipping tasks already in `backgroundedSubagentTaskIds`), then calls `query.interrupt()` without `query.close()`.
  - Waits up to 10 seconds for `currentTurn.ended`. If Claude ends the turn, the CLI process stays alive, `backgroundWorkContinues: true` is emitted, and `settledTurnByNativeThread` stays set so surviving work reports normally and individual subagents can still be stopped via `stopSubagent`.
  - If Claude does not end the turn within 10 seconds, the adapter clears the turn-scoped marker and falls back to `query.close()`. If `close()` also times out, it fails with `ProviderAdapterInterruptTimeoutError` so the UI offers **Force stop**.
  - If the CLI exits before settlement or a full Stop arrives mid-wait, the turn-scoped marker is cleared so no dead background work is reported as continuing.

## What the user and model see after Stop

### What the user sees

- The active turn ends with status `Interrupted` (`Stopped by user`). Any foreground tool call cut short by the interrupt shows as `interrupted`, not `failed`.
- Queued messages stay held until resumed.
- Surviving background commands, delegated tasks, pull request watches, and any surviving subagents remain listed in the **Running / Waiting** strip above the composer.
- The strip's **Stop** button is immediately active and stops all remaining background work (and closes the Claude process).
- If the CLI hangs and ignores Stop, the **Force stop** banner appears as before.
- Sending a follow-up message reuses the live Claude session without killing background commands.

### What the model sees

- The interrupted foreground tool receives a user-rejected tool result and `[Request interrupted by user for tool use]`, and the turn settles with `error_during_execution` (`terminal_reason: "aborted_tools"` or `"aborted_streaming"`).
- When a surviving background command finishes later, Claude Code emits `task_notification` and starts a wake turn with the command's result.

## Known SDK limitation

In `@anthropic-ai/claude-agent-sdk` `0.3.321` (Claude Code `2.1.321`), `Query` exposes `interrupt()`, `backgroundTasks(toolUseId?)`, `stopTask(taskId)`, and `close()`. There is no SDK option on `interrupt()` to prevent Claude Code's own CLI interrupt handler from stopping native background `Agent` tasks.

- **Background Bash commands** survive `query.interrupt()` without `query.close()`, stay on the Waiting strip, and wake the thread on completion.
- **T3 delegated tasks (`delegate_task`)** and **pull request watches** survive composer Stop completely and wake the thread on completion.
- **Claude native subagents (`Agent` tool)**: T3 backgrounds foreground subagents before `query.interrupt()`, keeps the CLI process open, and will keep any native subagent running if the Claude CLI preserves it across `interrupt()`. However, current Claude Code CLI versions (`2.1.292` through `2.1.323`) kill native background `Agent` tasks inside their own `interrupt` handler even without `query.close()`. When the CLI emits `task_notification` with `status: "stopped"` for those agents, T3 shows them as cancelled accurately. If you want to detach a single foreground Bash call or subagent without calling `interrupt()` at all, use **Move to background** (`Ctrl+B`) instead of Stop.
