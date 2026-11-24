# Tray Mode and Long-Running Background Work

This feature keeps T3 Code running in the Windows and Linux system tray when the window closes. It also keeps hours-long Claude background commands alive and makes sure they wake their thread when they finish.

## Why Desktop Tray Instead of Attaching to `t3 service`

Upstream includes a headless background service (`t3 service install`, documented in `docs/user/background-service.md`). On Windows, that service runs as a Task Scheduler task (`t3code-<domain>-<user>`) and holds an exclusive lock on `server-owner.sqlite`.

The upstream desktop app does not attach to a running `t3 service`. When another server owns the T3 home, `DesktopApp.ts` shows `DesktopHomeOwner.homeOwnedMessage` and exits unless the user turns off Local environment and pairs as a remote client.

We chose a desktop tray that keeps the desktop-owned backend alive instead of auto-attaching to `t3 service`:

- **Low merge conflict risk:** Auto-attaching to `t3 service` (as in upstream PR #41527) edits `DesktopHomeOwner.ts`, `DesktopLocalEnvironmentAuth.ts`, `DesktopAppSettings.ts`, preload, IPC, and contracts. A self-contained tray module in `apps/desktop/src/fork/tray/` needs only one hook line in `DesktopApp.ts` and one line in `apps/web/src/routes/__root.tsx`.
- **Safe side-by-side operation:** The fork runs beside the installed Nightly without creating Windows Task Scheduler tasks or touching `~/.t3`.
- **Zero lost desktop features:** Hiding the `BrowserWindow` keeps the local backend, running agents, WSL backend, T3 Connect, renderer notifications, and taskbar badges active. Clicking the tray icon restores the window immediately without reloading.
- **Trade-off:** A hidden Electron window keeps renderer memory (about 350 to 400 MiB) and agent preview screenshots can time out while hidden (upstream #38523). Keeping everything alive with a minimal fork diff is the better trade-off here.

## Tray Behavior

- **Close window (X, Alt+F4, taskbar close):** On Windows and Linux, closing the main window calls `event.preventDefault()` and hides the window to the system tray. macOS keeps its native Dock behavior.
- **Auxiliary windows:** Splash, preview, and image popup windows keep their normal close behavior.
- **Windows logoff and shutdown:** When Electron emits `session-end`, close-to-tray steps aside so Windows can shut down cleanly.
- **Relaunch:** Starting T3 Code while hidden triggers the single-instance handler and reveals the existing window.
- **Tray icon click:** Left-clicking the tray icon reveals and focuses the main window.
- **Tray context menu:**
  - **Open:** Reveals and focuses the main window.
  - **New thread:** Reveals the main window and dispatches `fork.newThread`. The web listener opens a No project draft (or falls back to the new-thread project picker).
  - **Close to tray:** Checkbox, enabled by default. Turning it off writes `<userData>/fork-tray.json`, reveals the window if hidden, and restores normal quit on window close.
  - **Quit:** Runs `app.quit()`, which runs the normal two-phase shutdown (`before-quit`, destroys windows, stops all backends cleanly, and destroys the tray icon).

## Settings and Rollback

Tray flags live in `<userData>/fork-tray.json`, owned by the fork module (`DesktopAppSettings.ts` is untouched):

```json
{
  "closeToTray": true,
  "openAtLogin": false,
  "startHidden": true
}
```

Ways to turn close-to-tray off:

1. Right-click the tray icon and uncheck **Close to tray**.
2. Set `"closeToTray": false` in `<userData>/fork-tray.json` and restart.
3. Set environment variable `T3_FORK_CLOSE_TO_TRAY=0`.

When turned off at startup, `DesktopTray.install` returns early and creates no tray icon, restoring exact upstream behavior.

## Hours-Long Claude Background Commands

This feature ports two open upstream bug-fix PRs so a Claude background command (`Bash` with `run_in_background`) that runs for more than 4 hours still finishes and wakes its thread:

1. **Upstream PR #29354** (`fix(server): keep Claude background work alive past idle pin limit`, authors Lakshmi Tanmay `voltcrash` and `maria-rcks`):
   - In `ProviderSessionManager.ts`, sessions with process-bound background work (`backgroundTasksEndWithProcess === true`, which `ClaudeAdapterV2` sets) stay pinned past `DEFAULT_MAX_IDLE_PIN_MS` (4 hours).
   - Uses `Effect.repeat` instead of recursion so long pins use constant memory.
   - Once pending background work ends, the session releases normally after `idleTimeoutMs`.
2. **Upstream PR #36029** (`fix(server): an idle Claude thread now wakes when its background command finishes`, author Alan Yang `syanga`):
   - In `ClaudeAdapterV2.ts`, `hasPendingBackgroundWork` also checks `owedWakeTasksForNativeThread` for remembered native threads.
   - Prevents the session manager from closing the Claude CLI process in the gap between `task_notification` clearing the roster and Claude starting its wake turn.

## Fork Layout and Upstream Hooks

- `apps/desktop/src/fork/tray/DesktopTray.logic.ts` - Flag schema, env resolution, and pure `shouldHideOnClose` decision.
- `apps/desktop/src/fork/tray/DesktopTray.ts` - Tray icon, menu, close interception, `session-end` handling, and scope cleanup.
- `apps/desktop/src/fork/tray/DesktopTray.logic.test.ts` and `DesktopTray.test.ts` - Unit tests.
- `apps/web/src/fork/tray/forkTrayMenuAction.ts`, `ForkTrayMenuListener.tsx`, `forkTrayMenuAction.test.ts` - Renderer handler for the tray **New thread** item.
- Upstream hooks (all marked `// fork:`):
  - `apps/desktop/src/app/DesktopApp.ts` - Calls `DesktopTray.install` after `applicationMenu.configure`.
  - `apps/web/src/routes/__root.tsx` - Mounts `<ForkTrayMenuListener />`.
  - `apps/server/src/orchestration-v2/ProviderSessionManager.ts` - Port of PR #29354.
  - `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` - Port of PR #36029.
