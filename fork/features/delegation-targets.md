# Per-instance allowed delegation targets

This feature adds a per-instance setting that limits which provider instances a thread on that instance may delegate to through `delegate_task`.

## Problem

A workspace can hold both work and personal provider instances (for example `claudeWork`, `claudeAgent`, and `antigravity`). Without a per-instance allowlist, a thread on `claudeWork` can delegate to a personal instance directly. It can also reach a personal instance through a delegation agent whose default provider is `antigravity`.

## Setting

The optional `allowedDelegationTargets` field lives on the provider instance envelope (`ProviderInstanceConfig` in `packages/contracts/src/providerInstance.ts`), so it applies to every provider driver.

| Property            | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Field               | `providerInstances.<id>.allowedDelegationTargets`                            |
| Type                | Optional array of `ProviderInstanceId` strings                               |
| Default when absent | No limit. The instance may delegate to any local or remote target.           |
| Empty array `[]`    | No delegation at all. Local and remote `delegate_task` calls fail.           |
| Settings UI         | **Settings > Providers > [Instance] > Runtime > Allowed delegation targets** |

## Behavior

1. `OrchestratorMcpService.delegateTask` enforces the allowlist after it resolves the final local target (explicit `target.providerInstanceId`, `target.driverKind`, agent default `provider`, or inherited caller instance).
2. If the caller instance defines `allowedDelegationTargets` and the resolved target instance is not in the list, `delegate_task` fails with `invalid_request`:
   - Non-empty list: `This provider instance may delegate only to: <list>.`
   - Empty list (`[]`): `This provider instance cannot delegate.`
3. `delegate_task` without a `target` inherits the caller instance. It succeeds when the caller instance is in its own `allowedDelegationTargets` list and fails otherwise.
4. The server blocks remote delegation (`target.environmentId`) whenever the caller instance defines `allowedDelegationTargets` (empty or non-empty). Remove the list to allow remote delegation.
5. `OrchestratorMcpService.capabilities` marks every provider instance outside the caller allowlist with `canRunChildTask: false`, `canRunCrossProviderChildTask: false`, and the constraint `Not an allowed delegation target for this instance.`.
6. `ProviderInstanceRegistry` excludes `allowedDelegationTargets` from `runtimeEqual`, so an edit in Settings does not close or restart live provider instances.

## Hook points

| File                                                        | Change                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/providerInstance.ts`                | Spread `ForkDelegationTargetsFields` into `ProviderInstanceConfig`.                                       |
| `packages/contracts/src/index.ts`                           | Re-export `./forkDelegationTargets.ts`.                                                                   |
| `apps/server/src/provider/ProviderInstanceRegistry.ts`      | Exclude `allowedDelegationTargets` in `withoutPresentation` so edits do not restart live instances.       |
| `apps/server/src/mcp/OrchestratorMcpService.ts`             | Mark disallowed providers in `capabilities` and enforce the allowlist on local and remote `delegateTask`. |
| `apps/web/src/components/settings/ProviderInstanceCard.tsx` | Mount `ForkDelegationTargetsRow` in the Runtime section for every instance.                               |

## Turn off

Clear **Allowed delegation targets** on the provider instance, click its reset button, or remove `allowedDelegationTargets` from `providerInstances.<id>` in `settings.json`.
