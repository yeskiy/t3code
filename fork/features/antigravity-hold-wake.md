# Antigravity Post-Settle Hold Wake

## Problem

When `agy` starts a long background command and ends its prompt while waiting, T3 holds the turn open until the command finishes. Upstream PR #40858 bounded that hold with `postSettleCommandHold.timeout` (30 minutes) so a lost terminal update cannot keep a thread in Working forever. When the 30-minute hold expired, `schedulePostSettleHoldExpiry` called `finalizeTurn` silently, leaving a delegated task or thread with only the agent's earlier waiting message and no status report.

## Design

- **ACP adapter option (`packages/provider-acp/src/server/adapter.ts`, `packages/provider-acp/src/server/fork/postSettleWake.ts`):**
  - `AcpAdapterV2Flavor["postSettleCommandHold"]` accepts an optional `wakePrompt?: (commands: ReadonlyArray<AcpToolCallState>) => string`. Flavors that leave `wakePrompt` unset keep upstream first-expiry finalization.
  - `ActiveAcpTurn` tracks `postSettleHoldWoken` (initialized to `false` per turn).
  - `schedulePostSettleHoldExpiry` binds its loop to the settled prompt's `promptSequence` so a user steer or Stop retires the old hold loop instead of firing late.
  - On the first hold expiry where at least one running command holds the turn alone, `handlePostSettleCommandHoldExpiry` calls `steerWithPrompt` with an atomic `claim` check inside `runtimeTransitionPermit` and `runtimeCallbackPermit`. The guard verifies the hold still applies and sets `postSettleHoldWoken = true` once.
  - After the wake prompt runs, the turn follows normal settlement: if the command completed, the turn finalizes immediately; if a command still runs and goes silent for another 30 minutes, the second expiry sees `postSettleHoldWoken === true` and calls `finalizeTurn`.
  - If wake dispatch fails while the hold still applies, `handlePostSettleCommandHoldExpiry` falls back to `finalizeTurn`. If a user Stop or steer won the race, it exits without finalizing.
- **Antigravity flavor (`apps/server/src/fork/ForkAntigravityHoldWake.ts`, `apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.ts`):**
  - `AntigravityAdapterV2` opts in by setting `postSettleCommandHold.wakePrompt` to `buildAntigravityHoldWakePrompt`.
  - Without command titles, the prompt text is: `A background command you started has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.`
  - When running command titles are available, they are normalized, deduplicated, bounded to 160 characters each, and inserted after `started` as `(<titles>)`.

## Turn off

Remove `wakePrompt: buildAntigravityHoldWakePrompt` from `postSettleCommandHold` in `apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.ts`.
