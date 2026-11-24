# External open for links and files

This fork adds a single Settings group that opens clicked links in the system browser and clicked local files in their default OS app. Both settings default to the external choice.

## Settings

Location: **Settings -> General -> Opening links and files**.

1. **Open links in** (`t3code:fork:open-links-in:v1`, default `"system"`):
   - **System browser** (`"system"`, default): opens clicked web URLs, pull request links, issue links, `mailto:` links, web image/video links, terminal URLs, discovered local server links, and project script preview URLs in the system browser or mail app.
   - **T3 browser** (`"app"`): restores upstream in-app link handling (built-in browser preview, PR panel, issue panel, and media lightbox).
   - Stays in sync with upstream **Settings -> Browser -> Browsing -> Open links in**.

2. **Open files in** (`t3code:fork:open-files-in:v1`, default `"external"`):
   - **Default app** (`"external"`, default): opens clicked local files (HTML, PDF, images, audio, video, code, and documents) from chat links, file citations, tool output, inline images, the file tree, breadcrumbs, file picker, content search, diffs, mentions, and skills in the default OS app via Electron `shell.openPath`.
   - **T3 viewer** (`"app"`): restores upstream in-app file viewer and image lightbox behavior.
   - Hold `Alt` while clicking a chat file link, mention chip, or inline image to open it inside T3 Code. Hold `Ctrl` or `Cmd` on a chat file link to open it in your preferred editor.

## Agent-driven previews vs. user clicks

The settings only cover user clicks in the UI. Agent browser tools (`preview_open`, `preview_navigate`, `preview_act`, `preview_snapshot`) run through the server preview service and push session updates to `agentOpenedPreviews.ts` and `ElectronBrowserHost.tsx`. That path stays untouched so agents can still open and test pages in the built-in browser.

Explicit in-app chrome actions (such as opening a new browser tab from the panel toolbar, typing in the preview address bar, or clicking "Open file in preview browser" inside the file viewer) also continue to work. Internal T3 Code links (quoted assistant response citations, thread links, same-document `#anchor` links, and `t3code://` deep links) stay in-app.

## Security

- **External URLs**: only `http:`, `https:`, and `mailto:` URLs are allowed to go to the system browser or mail client. `ElectronShell.ts` validates schemes in the main process, and `localApi.ts` enforces the same allow-list in the non-desktop fallback.
- **Local files**: local paths never become `file://` URLs. They cross IPC (`desktop:fork:open-path`) to the Electron main process, which checks:
  1. The IPC sender matches the main app window `webContents`.
  2. The target `environmentId` matches this machine's host environment. Remote environments fall back to T3 Code's viewer.
  3. The path is a non-empty local absolute path with no control characters, URI schemes, UNC shares, or Windows device prefixes.
  4. The file exists on disk (`fs.stat`), and its `realPath` passes the same path check after symlink resolution.
  5. On Windows, executable and script extensions (`.exe`, `.bat`, `.cmd`, `.com`, `.msi`, `.ps1`, `.vbs`, `.lnk`, `.url`, `.hta`, `.reg`, `.scr`, `.jar`, `.dll`, and similar) are blocked from launching through `shell.openPath`.
- Because local files open with `Electron.shell.openPath` directly, opening files on Windows does not spawn `powershell.exe -EncodedCommand`.

## Files

- `apps/desktop/src/fork/externalOpen/openPath.logic.ts` and `openPath.ts`: path validation and IPC handler.
- `apps/web/src/fork/externalOpen/externalOpen.logic.ts`: storage schemas, URL checks, path normalization, and action resolution.
- `apps/web/src/fork/externalOpen/forkExternalOpen.ts`: hooks and runtime open helpers.
- `apps/web/src/fork/externalOpen/ForkExternalOpenSection.tsx`: Settings UI section.
- Small `// fork:` hooks in upstream files to wire the settings and open handlers.
