# Artifacts Panel

## What it does

When an agent calls `html_render`, the rendered HTML continues to appear inline in the chat timeline. With **Show renders as artifacts** turned on, the right panel also offers an **Artifacts** view for the current thread.

The Artifacts view lists every completed HTML render in the current thread, newest first, with its title and timestamp. Clicking an item opens it full size in the right panel inside the same sandboxed viewer used by chat. Clicking **Artifacts** in the viewer header returns to the list.

You can open the Artifacts panel in three ways:

1. From the right panel empty state or the `+` tab menu (shortcut `A`).
2. From the **Open in artifacts panel** button in the hover toolbar of any inline chat render.
3. From the **Artifacts** row in the thread details card when the thread has at least one render.

## Setting

- **Name**: `Show renders as artifacts`
- **Location**: Settings -> General -> Display
- **Default**: On (`true`)
- **Storage key**: `t3code:fork:artifacts-panel:v1` (via `apps/web/src/hooks/useLocalStorage.ts`)

Turning the setting off hides the Artifacts launcher entry, the inline open button, the thread details row, and the **Artifacts** choice in **Show in thread details**. If an Artifacts tab is already open, it shows an off state with a button to turn the setting back on.

When **Show renders as artifacts** is on, **Artifacts** also appears in **Settings -> Appearance -> Thread details** and in the thread details card right-click menu (on by default, stored under client setting `threadDetailsItems.artifacts`). Turning it off there hides only the thread details card row while keeping the right panel tab and inline open button available.

## Security model

The panel reuses the existing renderer and server asset pipeline without changing any security boundaries:

- Asset URLs are minted with `useLongLivedAssetUrl` using the same `{ _tag: "attachment", attachmentId, fileName, mimeType: "text/html", disposition: "inline" }` request.
- The server serves `-html` attachments with `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads`.
- The panel renders through `HtmlRenderDocument`, which uses `<iframe sandbox="allow-scripts allow-forms">` (no `allow-same-origin`).
- No new script bridge, no looser sandbox flags, and no new server endpoints are added.

## Files

Fork code lives in `apps/web/src/fork/artifacts/`:

- `artifacts.logic.ts` / `artifacts.logic.test.ts`: setting key/default, extraction of completed `html_render` turn items, newest-first ordering, deduplication, and selection lookup.
- `forkArtifactsSetting.ts`: localStorage hook and reader for the setting.
- `forkArtifactsStore.ts`: per-thread selected artifact state and helpers to open the Artifacts surface.
- `ForkArtifactsPanel.tsx`: list and full-size viewer rendered in the right panel.
- `ForkArtifactsPanel.browser.test.tsx`: browser test covering empty state, newest-first list, strict sandbox attributes, back navigation, setting toggle, and inline open button.
- `ForkArtifactsSettingRow.tsx`: Settings toggle row.
- `ForkArtifactOpenButton.tsx`: hover action button on inline chat renders.
- `ForkThreadDetailsArtifactsRow.tsx` / `ForkThreadDetailsArtifactsRow.browser.test.tsx`: quick-open row with artifact count in the thread details card, plus browser tests for **Show in thread details** visibility and toggling.
- `forkThreadDetailsItems.ts` / `forkThreadDetailsItems.test.ts`: fork thread details item entry (`artifacts`) and filtering when **Show renders as artifacts** is off.

Small `// fork:` hooks in upstream files:

- `apps/web/src/rightPanelStore.ts`: registers `"artifacts"` in `RIGHT_PANEL_KINDS`, `RightPanelSurface`, and `singletonSurface`.
- `apps/web/src/closedViewStore.ts`: allows closed `"artifacts"` tabs to be remembered and reopened.
- `apps/web/src/components/RightPanelTabs.tsx`: tab title, icon, and optional launcher entry (`A`).
- `apps/web/src/components/chat/RightPanelSurfaceContent.tsx`: lazy-loads `ForkArtifactsPanel` for `kind === "artifacts"`.
- `apps/web/src/components/chat/useRightPanelActions.ts`: exposes `addArtifactsSurfaceStable`.
- `apps/web/src/components/ChatView.tsx`: wires the setting and `onAddArtifacts` into `ChatRightPanel`.
- `apps/web/src/components/chat/HtmlRenderFrame.tsx`: renders `ForkArtifactOpenButton` beside full screen.
- `apps/web/src/components/chat/threadDetailsItems.ts`: appends `FORK_THREAD_DETAILS_ITEMS` and allows filtering items in `isDefaultThreadDetailsVisibility`.
- `apps/web/src/components/chat/ThreadDetailsItemsMenu.tsx`: filters the shared **Show in thread details** menu through `useForkThreadDetailsItems`.
- `apps/web/src/components/settings/ThreadDetailsItemsRow.tsx`: filters the Settings -> Appearance -> Thread details count and reset state through `useForkThreadDetailsItems`.
- `apps/web/src/components/chat/ThreadDetailsPanel.tsx`: filters `contentKey` through `useForkThreadDetailsItems` and gates `ForkThreadDetailsArtifactsRow` on `visible.artifacts`.
- `apps/web/src/components/settings/SettingsPanels.tsx`: renders `ForkArtifactsSettingRow` under Display.

## Manual test checklist

1. Open Settings -> General -> Display and confirm **Show renders as artifacts** is on by default.
2. Open a thread with two or more `html_render` outputs and verify the inline chat renders still work.
3. Open the right panel, add **Artifacts** (or press `A`), and confirm renders appear newest first with title and time.
4. Click an artifact and confirm it renders full size in the panel, resizes when you drag or maximize the panel, and returns to the list on **Artifacts** back click.
5. Hover an inline chat render and click **Open in artifacts panel** to jump straight to that render in the right panel.
6. Open the thread details card and confirm the **Artifacts** row shows the count and opens the Artifacts tab.
7. Open Settings -> Appearance -> Thread details (or right-click the thread details card), confirm **Artifacts** is checked by default, uncheck it, and verify the **Artifacts** row disappears from the thread details card while the right panel tab still works.
8. Turn **Show renders as artifacts** off in Settings and verify the launcher entry, hover button, thread details row, and **Artifacts** choice in **Show in thread details** disappear, while inline chat renders stay visible.
