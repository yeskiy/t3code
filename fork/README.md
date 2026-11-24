# Personal T3 Code Fork

This fork tracks `upstream/main` (`pingdotgg/t3code`) and publishes its own Windows builds and auto-update feed from `yeskiy/t3code`. The goal is to keep every fork change isolated so upstream merges stay small and predictable.

## Layout rule

Keep fork code in new files and leave upstream files nearly untouched:

- **New app code:** `apps/<app>/src/fork/<feature>/` (for example `apps/web/src/fork/sharpText/` or `apps/desktop/src/fork/updater/`).
- **New shared package code (when needed):** `packages/<pkg>/src/fork/`.
- **Fork scripts and tools:** `fork/` and `fork/tools/`.
- **Per-feature documentation:** `fork/features/<feature>.md`, one file per feature. Do not append to a shared feature list file, so parallel feature branches never conflict on docs.
- **Fork CI:** `.github/workflows/fork-build.yml`. Never edit upstream workflow files or composite actions.
- **Upstream hooks:** keep edits in upstream files to small mounts or one-line calls. Mark each upstream hunk with a one-line `// fork:` comment so merge conflicts are obvious.
- **Feature flags:** put each behavior behind a flag that returns early to the upstream path when off.
- **English-only copy:** fork UI text stays in English and does not touch upstream `gt` translation catalogs. Start fork UI files with `/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */`.

Do not move existing fork files that already work. Follow the `src/fork/<feature>/` layout for new features.

## Where existing fork features live

These features already exist in the fork (from Wave 0 and Wave 1):

| Feature                                 | New fork files                                                                                                                                                                                                                                                                 | Upstream hook files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Turn off                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Fork profile override                   | `apps/desktop/src/app/ForkUserDataName.ts`                                                                                                                                                                                                                                     | `apps/desktop/src/app/DesktopUserData.ts`, `apps/desktop/src/app/DesktopUserData.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Leave `T3CODE_DESKTOP_USER_DATA_NAME` unset                                |
| Fork link handler and PATH guard        | `apps/desktop/src/app/ForkProtocolGuard.ts`, `apps/desktop/src/app/ForkProtocolGuard.test.ts`                                                                                                                                                                                  | `apps/desktop/src/app/DesktopClerk.ts`, `apps/desktop/src/app/DesktopCliCommand.ts`, `apps/desktop/src/app/DesktopCliCommand.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Leave `T3CODE_DESKTOP_USER_DATA_NAME` unset                                |
| Isolated launcher and tools             | `fork/Start-T3Fork.ps1`, `fork/tools/desktop-failed-tests.mjs`, `fork/tools/Test-ClearType.ps1`                                                                                                                                                                                | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Run packaged build directly                                                |
| New threads open in No project          | `apps/web/src/fork/newThreadDefault/` (`ForkIndexLanding.tsx`, `ForkNewThreadDefaultRow.tsx`, `forkNewThreadDefault.ts`, `newThreadDefault.logic.ts`, `newThreadDefault.logic.test.ts`)                                                                                        | `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/settings/SettingsPanels.tsx`, `apps/web/src/routes/_chat.index.tsx`, `apps/web/src/shortcuts/chatRouteCommands.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Settings > General > Sidebar > New threads open in: Last used project      |
| Sharp text (ClearType)                  | `apps/web/src/fork/sharpText/` (`ForkSharpTextRow.tsx`, `sharpText.css`, `sharpText.ts`, `sharpText.logic.ts`, `sharpText.logic.test.ts`)                                                                                                                                      | `apps/web/src/components/settings/AppearanceSettingsPanel.tsx`, `apps/web/src/main.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Settings > Appearance > Sharp text off                                     |
| Move tool call to background (`Ctrl+B`) | `apps/web/src/fork/toolCallBackground/`, `apps/server/src/fork/ForkToolCallControl.ts`, `apps/server/src/fork/ForkToolCallControl.test.ts`, `packages/contracts/src/forkToolCall.ts`                                                                                           | `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/chat/TimelineWorkEntryRow.tsx`, `apps/web/src/keybindings.ts`, `apps/web/src/keybindings.test.ts`, `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/auth/RpcAuthorization.test.ts`, `apps/server/src/observability/RpcInstrumentation.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`, `apps/server/src/orchestration-v2/runtimeLayer.ts`, `apps/server/src/ws.ts`, `apps/server/src/ws.test.ts`, `packages/contracts/src/clientRpcPermissions.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/keybindings.ts`, `packages/contracts/src/rpc.ts`, `packages/provider-core/src/server/ProviderAdapter.ts`, `packages/shared/src/keybindings.ts` | Set localStorage `t3code:fork:tool-background:v1` to `false`               |
| Fork layout, upstream sync, and CI      | `fork/README.md`, `fork/Sync-Upstream.ps1`, `fork/features/fork-layout-ci.md`, `.github/workflows/fork-build.yml`, `apps/desktop/src/fork/updater/ForkUpdateFeed.test.ts`                                                                                                      | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Disable `fork-build.yml` on GitHub                                         |
| Delegation agent definitions            | `packages/contracts/src/forkDelegationAgent.ts`, `apps/server/src/fork/delegationAgents/` (`agentFile.ts`, `skillText.ts`, `ForkDelegationAgents.ts`), `fork/features/delegation-agents.md`                                                                                    | `packages/contracts/src/index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Empty `<stateDir>\agents`                                                  |
| Claude instance launch fields           | `packages/contracts/src/forkInstanceLaunch.ts`, `apps/server/src/fork/instanceLaunch/` (`mcpConfigMerge.ts`, `prepareCommand.ts`, `ForkClaudeLaunch.ts` and tests), `fork/features/instance-launch.md`                                                                         | `packages/contracts/src/settings.ts`, `packages/contracts/src/index.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`, `apps/server/src/provider/ProviderInstanceRegistry.test.ts`, `packages/provider-core/src/server/failure.ts`, `packages/provider-core/src/server/failure.test.ts`, `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`                                                                                                                                                                                                                                                                                                                                                                                      | Clear MCP config files and Prepare command on the Claude instance          |
| Antigravity post-settle hold wake       | `packages/provider-acp/src/server/fork/postSettleWake.ts`, `packages/provider-acp/src/server/fork/postSettleWake.test.ts`, `apps/server/src/fork/ForkAntigravityHoldWake.ts`, `apps/server/src/fork/ForkAntigravityHoldWake.test.ts`, `fork/features/antigravity-hold-wake.md` | `packages/provider-acp/src/server/adapter.ts`, `apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.ts`, `apps/server/src/orchestration-v2/Adapters/AntigravityAdapterV2.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Remove `wakePrompt` from `AntigravityAdapterV2.ts` `postSettleCommandHold` |

## Branch model

| Remote     | URL                                                                        | Rule                                                      |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `upstream` | `https://github.com/pingdotgg/t3code.git` (`blob:none`, fetch `main` only) | Source of upstream commits. Never push.                   |
| `origin`   | `https://github.com/yeskiy/t3code.git`                                     | Personal fork. Its `main` holds the published fork state. |

| Branch           | Role                                                               | Rule                                                                                                                |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `upstream/main`  | Upstream mirror                                                    | Fetch only. Never commit.                                                                                           |
| `feature/<name>` | One branch per fork feature                                        | Long-lived feature branch. Synced with `upstream/main` via merge.                                                   |
| `fork/main`      | Integration branch (`upstream/main` plus all `feature/*` branches) | Updated by forward merges only. Pushed to `origin/main` with `git push origin fork/main:main` (never force-pushed). |

### Why merge instead of rebase

Use merges, not rebases, to bring `upstream/main` into `feature/*` branches and rebuild `fork/main`:

1. **No force-pushes.** Upstream lands roughly 1,800 commits per week. Rebasing rewrites every commit hash on every sync and forces `--force` pushes to `origin/main` and published branches. Forward merges keep `fork/main` fast-forwardable on `origin/main`.
2. **Safe with sibling worktrees.** Parallel agents work in linked git worktrees checked out on `feature/*` branches. Rewriting a branch behind a worktree breaks history and loses refs. Forward merges advance each branch cleanly in its own worktree.
3. **One conflict resolution per sync.** Rebasing a multi-commit feature branch replays the same conflict on every commit. A merge resolves each conflicted hunk once, and `git config rerere.enabled true` replays past resolutions automatically.
4. **Safe for branches cut from `fork/main`.** Feature branches started from `fork/main` already contain earlier Wave 0 and Wave 1 commits. Rebasing them onto `upstream/main` would duplicate those commits; merging `upstream/main` handles both `upstream/main`-based and `fork/main`-based branches without duplicating history.

### Syncing with upstream

Run `fork/Sync-Upstream.ps1` from the repository root:

```powershell
# Preview the plan without changing any branch
powershell -NoProfile -ExecutionPolicy Bypass -File fork/Sync-Upstream.ps1 -DryRun

# Fetch upstream/main, merge it into each feature/* branch, and merge all into fork/main
powershell -NoProfile -ExecutionPolicy Bypass -File fork/Sync-Upstream.ps1

# Sync only specific feature branches
powershell -NoProfile -ExecutionPolicy Bypass -File fork/Sync-Upstream.ps1 -Features feature/fork-layout-ci,feature/tray-background

# Resume after resolving a merge conflict
powershell -NoProfile -ExecutionPolicy Bypass -File fork/Sync-Upstream.ps1 -SkipFetch

# Delete local feature/* branches already merged into fork/main (never deletes without -Force)
powershell -NoProfile -ExecutionPolicy Bypass -File fork/Sync-Upstream.ps1 -DeleteMerged -Force
```

Script safety rules:

- Never force-pushes and never pushes to any remote.
- Never deletes any branch unless both `-DeleteMerged` and `-Force` are passed, and even then only uses `git branch -d` on branches not checked out in a worktree.
- Refuses to start if any target worktree has uncommitted changes or an in-progress merge or rebase.
- Stops on the first merge conflict, lists every conflicted file, and prints the exact commands to resolve and resume or abort.

After a clean sync, verify changed packages and push `fork/main` manually:

```powershell
vp run check:changed upstream/main
git push origin fork/main:main
```

After pushing an upstream merge, check whether upstream added any new workflow files and disable them on `yeskiy/t3code`.

## Version scheme and auto-update

Fork releases use the version format `0.1.<P>-fork.<N>` on the `latest` (stable) channel:

- **`P`** is the patch number of the newest upstream nightly base plus 1. Today upstream nightlies are `0.1.12-nightly.*`, so `FORK_VERSION_BASE` in `.github/workflows/fork-build.yml` is `0.1.13`. When upstream nightlies move to `0.1.13-*`, bump `FORK_VERSION_BASE` to `0.1.14`.
- **`N`** is `github.run_number` for manual or branch builds, or the suffix of a `v0.1.<P>-fork.<N>` tag.
- **Why it sorts above upstream nightlies:** in SemVer, `0.1.13-fork.1` sorts higher than every `0.1.12-nightly.*` because `0.1.13 > 0.1.12`. Within the fork series, numeric prerelease identifiers sort numerically (`0.1.13-fork.10 > 0.1.13-fork.9`).
- **Channel and update feed:** because `-fork.<N>` does not match `-nightly.YYYYMMDD.N`, both `resolveDesktopUpdateChannel` (`scripts/build-desktop-artifact.ts`) and `desktopUpdateChannelOf` (`packages/shared/src/cliRelease.ts`) return `latest`. Passing `T3CODE_DESKTOP_UPDATE_REPOSITORY=yeskiy/t3code` bakes `owner: yeskiy`, `repo: t3code`, and `releaseType: release` (no `channel: nightly`) into `resources/app-update.yml`.
- **Release type:** fork GitHub releases are normal releases marked `--latest` (not prereleases) with `T3-Code-<version>-x64.exe`, its `.blockmap`, and `latest.yml`. When the installed app checks for updates, `electron-updater` queries `https://github.com/yeskiy/t3code/releases/latest` and downloads `latest.yml` and the installer from `yeskiy/t3code`.
- **In-place replacement:** the release build keeps the upstream app identity (`com.t3tools.t3code`, profile `t3code-v2`, home `~/.t3/userdata`, port `3773`, scheme `t3code`), so the fork installer replaces T3 Code Nightly in place while keeping local threads, projects, and settings.
- **Native Windows build flag:** `.github/workflows/fork-build.yml` sets `T3CODE_DESKTOP_UNTRUSTED_BUNDLE=true` on `windows-2025`. Without it, `scripts/prepare-server-compile-cache.cjs` generates bytecode files on native Windows hosts and exceeds the 80-file Windows payload limit in `scripts/build-desktop-artifact.ts`. Official upstream releases avoid those files because they cross-build Windows on Linux.

## Upstream workflows to disable on `yeskiy/t3code`

Upstream workflows stay unchanged in git so merges stay clean. Disable all 27 upstream workflows on `yeskiy/t3code` so only `.github/workflows/fork-build.yml` stays active:

| Workflow file                       | Runner                                                        | Reason to disable                                              |
| ----------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| `ci.yml`                            | `blacksmith-*` (`ubuntu-2404`, `macos-27`)                    | Uses Blacksmith runners                                        |
| `deploy-relay.yml`                  | `blacksmith-8vcpu-ubuntu-2404`                                | Uses Blacksmith runner and upstream Cloudflare secrets         |
| `desktop-macos-preview.yml`         | `blacksmith-32vcpu-ubuntu-2404`                               | Uses Blacksmith runner                                         |
| `desktop-macos-preview-publish.yml` | `ubuntu-24.04`, `blacksmith-8vcpu-ubuntu-2404`                | Uses Blacksmith runner and publishes upstream previews         |
| `mobile-android-apk.yml`            | `blacksmith-2vcpu-ubuntu-2404`                                | Uses Blacksmith runner                                         |
| `mobile-dev-client.yml`             | `blacksmith-32vcpu-ubuntu-2404`, `blacksmith-12vcpu-macos-27` | Uses Blacksmith runners                                        |
| `mobile-eas-preview.yml`            | `blacksmith-*` (`ubuntu-2404`, `macos-27`)                    | Uses Blacksmith runners and upstream EAS secrets               |
| `mobile-eas-preview-fork.yml`       | `blacksmith-*` (`ubuntu-2404`, `macos-27`)                    | Uses Blacksmith runners and upstream EAS secrets               |
| `mobile-eas-production.yml`         | `blacksmith-*` (`ubuntu-2404`, `macos-27`)                    | Uses Blacksmith runners and upstream EAS secrets               |
| `mobile-fingerprint-check.yml`      | `blacksmith-8vcpu-ubuntu-2404`                                | Uses Blacksmith runner                                         |
| `mobile-showcase-screenshots.yml`   | `blacksmith-12vcpu-macos-27`, `blacksmith-16vcpu-ubuntu-2404` | Uses Blacksmith runners                                        |
| `publish-aur.yml`                   | `blacksmith-8vcpu-ubuntu-2404`                                | Uses Blacksmith runner and upstream AUR secrets                |
| `relay-preview.yml`                 | `blacksmith-8vcpu-ubuntu-2404`                                | Uses Blacksmith runner                                         |
| `relay-preview-cleanup.yml`         | `blacksmith-8vcpu-ubuntu-2404`                                | Uses Blacksmith runner                                         |
| `release.yml`                       | `blacksmith-*` (`ubuntu-2404`, `macos-27`), `ubuntu-24.04`    | Uses Blacksmith runners and upstream signing secrets           |
| `release-desktop.yml`               | Input `runner` / `verify_runner` (Blacksmith)                 | Reusable workflow called by `release.yml`                      |
| `web-preview.yml`                   | `blacksmith-8vcpu-ubuntu-2404`                                | Uses Blacksmith runner                                         |
| `windows-tests.yml`                 | `blacksmith-8vcpu-windows-2025`                               | Uses Blacksmith runner                                         |
| `agent-context-budget.yml`          | `ubuntu-24.04`                                                | Upstream PR check, covered by `fork-build.yml` `check:changed` |
| `issue-labels.yml`                  | `ubuntu-24.04`                                                | Upstream issue moderation                                      |
| `issue-vouch.yml`                   | `ubuntu-24.04`                                                | Upstream issue moderation                                      |
| `mobile-fingerprint-label.yml`      | `ubuntu-24.04`                                                | Upstream PR labeling                                           |
| `pr-limits.yml`                     | `ubuntu-24.04`                                                | Upstream PR moderation                                         |
| `pr-size.yml`                       | `ubuntu-24.04`                                                | Upstream PR moderation                                         |
| `pr-vouch.yml`                      | `ubuntu-24.04`                                                | Upstream PR moderation                                         |
| `stale-needs-more-info.yml`         | `ubuntu-latest`                                               | Upstream issue moderation                                      |
| `thread-transfer-report.yml`        | `ubuntu-24.04`                                                | Upstream automation                                            |
