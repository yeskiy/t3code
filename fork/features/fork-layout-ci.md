# Feature: Fork layout, upstream sync, and CI builds

## Summary

Defines the fork directory layout, per-feature docs rule, branch and upstream sync tooling, GitHub Actions CI and release workflow, and updater feed verification.

## Files owned by this feature

- `fork/README.md`: layout rule, existing feature inventory, branch model, merge vs. rebase rationale, version scheme, and list of upstream workflows to disable.
- `fork/Sync-Upstream.ps1`: fetches `upstream/main`, merges it into each `feature/*` branch (including branches checked out in linked worktrees), and updates `fork/main` with forward merges.
- `.github/workflows/fork-build.yml`: GitHub-hosted CI workflow (changed-package checks on `ubuntu-24.04`, Windows NSIS installer and unpacked app build on `windows-2025`, and manual or tagged release publishing to `yeskiy/t3code`).
- `apps/desktop/src/fork/updater/ForkUpdateFeed.test.ts`: verifies fork version channel classification, SemVer ordering above upstream nightlies, and `electron-updater` GitHub feed lookups against `yeskiy/t3code`.
- `fork/features/fork-layout-ci.md`: this document.

## Upstream hooks

None. No upstream source or workflow file was modified.

## Updater verification in code

Traced end to end from packaging to runtime update checks:

1. **Build config (`scripts/build-desktop-artifact.ts:2729-2757`, `:2850-2856`):**
   - `resolveDesktopUpdateChannel("0.1.13-fork.<N>")` returns `"latest"` because `-fork.<N>` does not match `/-nightly\.\d{8}\.\d+$/`.
   - `isDesktopPreviewVersion("0.1.13-fork.<N>")` returns `false`.
   - `resolveGitHubPublishConfig("latest")` reads `T3CODE_DESKTOP_UPDATE_REPOSITORY` (`yeskiy/t3code`) first, then `GITHUB_REPOSITORY`, and returns `{ provider: "github", owner: "yeskiy", repo: "t3code", releaseType: "release" }` with no `channel` field.
   - `electron-builder` bakes that object into `resources/app-update.yml` and generates `latest.yml`.
2. **Runtime feed loading (`apps/desktop/src/app/DesktopEnvironment.ts:215-217`, `apps/desktop/src/updates/DesktopUpdates.ts:453-479`, `:569-585`, `:1290-1333`):**
   - Packaged builds read `resources/app-update.yml`.
   - Unmanaged, non-mock builds never call `electronUpdater.setFeedURL(...)`, so `electron-updater` loads `resources/app-update.yml` directly (`AppUpdater.js:383`, `:482-487`).
   - `desktopUpdateChannelOf("0.1.13-fork.<N>")` (`packages/shared/src/cliRelease.ts:88-104`) returns `"latest"`, so `applyAutoUpdaterChannel("latest")` sets `channel = "latest"`, `allowPrerelease = false`, and `allowDowngrade = false`.
3. **GitHub feed lookup (`electron-updater/out/providers/GitHubProvider.js:92-105`, `:157-162`, `:228-248`, `AppUpdater.js:339-363`):**
   - `GitHubProvider.basePath` is `/yeskiy/t3code/releases`.
   - With `allowPrerelease = false`, `getLatestTagName()` fetches `https://github.com/yeskiy/t3code/releases/latest` (which returns `v0.1.13-fork.<N>` because fork releases are normal `--latest` releases) and downloads `latest.yml` from `/yeskiy/t3code/releases/download/v0.1.13-fork.<N>/latest.yml`.
   - `AppUpdater.isUpdateAvailable` compares `semver.gt(latestVersion, currentVersion)`, which accepts `0.1.13-fork.3 > 0.1.13-fork.2`.
   - `DesktopUpdates.ts:410-419` (`offerable`) checks `desktopUpdateChannelOf(offeredVersion) === "latest"`, which is `true` for every `0.1.<P>-fork.<N>` release.
4. **Known non-updater upstream references (documented, left untouched):**
   - `apps/desktop/src/app/DesktopStartupRecovery.ts:23` points a manual crash-recovery link button to `https://github.com/pingdotgg/t3code/releases`. Auto-update does not use it.
   - `packages/shared/src/cliRelease.ts:6` sets `CLI_RELEASE_REPOSITORY = "pingdotgg/t3code"` for SSH remote CLI downloads and track-switch migration lookups. Normal `latest` desktop auto-updates do not use it.
   - If an upgraded Nightly install still has `"updateChannel": "nightly"` saved in `~/.t3/userdata/desktop-settings.json`, `DesktopUpdates.ts:508-524` reports a track mismatch instead of downloading a nightly; switching to Stable in Settings > About resolves it.

## Rollback

Disable `.github/workflows/fork-build.yml` on GitHub and revert the commits that added the files listed above.
