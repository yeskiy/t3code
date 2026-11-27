# Per-instance idle process timeout

This feature adds a per-instance setting that controls how long T3 keeps an idle provider process alive after a turn ends.

## Problem

T3 releases an idle provider process after 2 minutes when the provider supports native resume, or after 30 minutes when it does not. A short idle timeout closes stdio Model Context Protocol (MCP) servers attached to that process, such as a Playwright browser, between turns.

## Setting

The optional `idleTimeoutMinutes` field lives on the provider instance envelope (`ProviderInstanceConfig` in `packages/contracts/src/providerInstance.ts`), so it applies to every provider driver.

| Property            | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Field               | `providerInstances.<id>.idleTimeoutMinutes`                                   |
| Type                | Optional integer from 1 to 1440 (1 minute to 24 hours)                        |
| Default when absent | 2 minutes with native resume, 30 minutes without native resume                |
| Settings UI         | **Settings > Providers > [Instance] > Runtime > Keep idle process (minutes)** |

## Behavior

1. `ProviderSessionManagerV2` resolves the idle timeout in `idleTimeoutFor(runtime)` with this priority order:
   1. `options.idleTimeoutMs` when tests pass an explicit layer option.
   2. `providerInstances[runtime.instanceId].idleTimeoutMinutes * 60_000` when the instance sets a value.
   3. The upstream default: 2 minutes when `supportsNativeResume` is true, or 30 minutes otherwise.
2. `ProviderSessionManagerV2` reads the setting live from `ServerSettingsService` on each idle schedule, defer recheck, and idle thread unload.
3. `ProviderInstanceRegistry` excludes `idleTimeoutMinutes` from `runtimeEqual`, so changing the value in Settings does not close or restart live provider instances.
4. Forced closes through `ProviderSessionManager.detach` (such as settling a thread) stay unchanged.

## Release of a finished delegate

When a delegated child has its result and no unawaited background work, `Orchestrator.releaseFinishedDelegateSessions` detaches its per-thread provider session. This close does not use the idle timer, so `idleTimeoutMinutes` has no effect on it.

`delegatedTaskProgress` skips a monitor wake run (a run that a `monitor` notification with outcome `updated` started), because such a run is not the work of the task. The child process still runs that turn, however. For this reason, the release also waits until the child has no active run (`isActiveRun`). The idle timer then releases the process after that run ends.

## Hook points

| File                                                                   | Change                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/providerInstance.ts`                           | Spread `ForkInstanceIdleTimeoutFields` into `ProviderInstanceConfig`.                                  |
| `packages/contracts/src/index.ts`                                      | Re-export `./forkInstanceIdleTimeout.ts`.                                                              |
| `apps/server/src/orchestration-v2/ProviderSessionManager.ts`           | Resolve `idleTimeoutFor(runtime)` from `ServerSettingsService` through `resolveInstanceIdleTimeoutMs`. |
| `apps/server/src/orchestration-v2/Orchestrator.ts`                     | Keep a finished delegate's session while the child has an active run.                                  |
| `apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts` | Test that a monitor wake run keeps the finished delegate's session.                                    |
| `apps/server/src/provider/ProviderInstanceRegistry.ts`                 | Exclude `idleTimeoutMinutes` in `withoutPresentation` so edits do not restart live instances.          |
| `apps/web/src/components/settings/ProviderInstanceCard.tsx`            | Mount `ForkInstanceIdleTimeoutRow` in the Runtime section for every instance.                          |

## Turn off

Clear **Keep idle process (minutes)** on the provider instance, or remove `idleTimeoutMinutes` from `providerInstances.<id>` in `settings.json`. T3 then uses the upstream 2-minute or 30-minute default.
