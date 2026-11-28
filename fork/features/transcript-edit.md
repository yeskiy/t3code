# Transcript Editing

Edit the full transcript of a Claude thread in place inside the chat timeline. Claude reads the edited JSON Lines (JSONL) session file on the next turn.

## What it does

- **Edit in place:** Hover a user, assistant, or work row to show the Edit button (pencil icon). The first edit click loads the Claude session file for the thread and opens the edit form inside the row. The form replaces a message row and opens below a work row.
- **Editable and read-only blocks:** Text blocks on user, assistant, and unlocked system entries are editable. Thinking blocks are read-only and can be removed, never edited, because Claude checks thinking signatures. Tool calls, tool results, and "Entry fields" (`type`, `uuid`, `parentUuid`, `timestamp`, `messageId`, `model`, raw JSON) are read-only. File entries without a T3 timeline item show as muted "Not shown in the timeline" rows while an edit session is open.
- **Compacted threads:** Claude reads only the part of the session file after the last `compact_boundary` entry, so only that part is editable. A row before the last compaction shows a muted "Before compaction" note in place of the Edit button, with a tooltip that gives the reason, and gets no checkbox in Select mode. Before the first load, the last completed Claude `compaction` timeline item marks the cut. After the load, `compactionItemId` in the load result marks it, or removes the note when the active path does not start at a boundary.
- **Recovered sessions:** When T3 cannot resume a Claude session, it starts a new session with a handoff prompt that summarizes the earlier sessions. The editor opens only the current session file. A row of an earlier session shows a muted "Earlier session" note in place of the Edit button, with a tooltip that gives the reason, and gets no checkbox in Select mode. Before the first load, the session list of the provider thread (`nativeMetadata.forkClaudeSessions`) marks the rows. After the load, `earlierSessionItemId` in the load result marks the last row of the earlier sessions. For a thread without a session list, the server counts a provider turn as earlier when the session file does not hold its cursor.
- **Handoff prompt lock:** When the first user message of the session file starts with `Context handoff (`, the editor locks that unit like a compact boundary. Its text is read-only, it cannot move or be deleted, and no unit can go in front of it. The Edit button and the Select mode checkbox give the reason in a tooltip.
- **No silent failure:** If a click on Edit cannot open a form (not linked, locked, handoff, before compaction, earlier session), a toast gives the reason. A load error shows a toast with the server detail.
- **Row actions:** The edit form "More" menu offers Delete, Move up, Move down, Insert a message above, and Insert a message below (insert is not shown on tool units).
- **Pending changes and save bar:** No single edit, move, insert, or delete writes to disk alone. Every change stays pending as a step and previews in place in the timeline. Changed rows get a 2 px primary left border and a badge (`Edited`, `Moved`, `Moved and edited`, `Inserted`, `Moved here`, or `Cannot apply`). Removed rows collapse to one muted line with `Removed` and `Restore`. Inserted and moved units render as draft rows.
- **Review and one-write save:** One sticky save bar above the composer shows the pending change count, validation status, Undo, Redo, Select, Review changes, Discard, and Save. While changes are pending, Send is disabled in the composer while composer text stays intact. "Review changes" opens a dialog with all pending changes and a word diff for edited text. "Save" writes all changes to the session file in one atomic write.
- **Select mode:** Start Select mode with `Mod+Alt+S`, the thread menu item "Select messages", or "Select" in the save bar. A 28 px gutter adds checkboxes and a drag grip to each selectable row (a collapsed tool group uses one checkbox for its units, and locked entries show a disabled checkbox). Click, Shift+click ranges, drag over checkboxes to select or clear rows, or drag the grip (with `@dnd-kit/core`) to move one or more units. The Select bar shows the count as "N of M selected" and groups the actions: Select all or Clear, then Move up, Move down, and Move to..., then Insert above and Insert below, then Remove thinking and Delete, and Done. A disabled action shows the reason in its tooltip. Each bulk action is one undo step. A bar press keeps the focus in the timeline, so the Select keys keep working after it.
- **Pending order:** Every bulk action, key, drag, and insert builds its step from the unit order with all pending steps applied (`pendingUnits.logic.ts`). Move and delete steps apply locally with the server rules, so a second action before the preview returns gets a correct index. After an insert or a removed thinking block, the actions wait until the preview returns ("Updating the preview...").
- **Undo, redo, and revert:** Use the save bar buttons, `Mod+Z`, or `Mod+Shift+Z` to undo or redo steps. Revert one step from the pending-changes popover or a row marker, or restore one unit from its removed row.

## Providers

| Provider                                                    | Support                                                                                                                                              | Reason                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Claude (`claudeAgent` driver, any instance)                 | Full editing                                                                                                                                         | T3 knows the JSONL format, owns the Claude process, and resumes from the session file |
| Codex                                                       | Not offered. Edit is disabled with the tooltip "Transcript editing works for Claude threads only." The thread menu hides Select messages and backups | Codex uses a different rollout format and zstd archives                               |
| Antigravity and other Agent Client Protocol (ACP) providers | Not offered. Same disabled button, tooltip, and hidden thread menu items                                                                             | T3 cannot read native ACP session history                                             |
| Mixed thread (after a provider switch)                      | Only entries in the active Claude session file are editable. Earlier rows from another provider stay unchanged                                       | The session file holds only the Claude part of the thread                             |

## How a save works

The Claude session file (`<configDir>/projects/<slug>/<sessionId>.jsonl`) is the source of truth. The config directory comes from the instance `homePath`, `CLAUDE_CONFIG_DIR`, or `~/.claude`. On Save, `ForkTranscriptEdit` runs these steps:

1. Resolve the active Claude provider thread and locate its session file. Acquire the per-session path lock.
2. Read the file and compare its Secure Hash Algorithm 256 (SHA-256) conversation key (over lines with a `uuid`) against `baseKey`. If the file changed before any stop, refuse with `stale` so a running turn is not stopped for nothing.
3. Check thread runs. If any run is in `preparing`, `queued`, `starting`, `running`, or `waiting`, refuse with `busy` unless `confirmStop` is true. With `confirmStop`, dispatch `thread.stop` (`scope: "turn"`) and wait up to 20 seconds (40 polls at 500 ms) for all runs to become idle, else refuse with `stopFailed`.
4. Call `ProviderSessionManagerV2.releaseUnlessBusy` with `ownProviderThreadIds: []` and reason `"manual_shutdown"`. This closes the live Claude process, also an idle process held by "Keep idle process". If the session is still busy, refuse with `busy`.
5. Take `ThreadCommandExecutor.withLock(threadId)` to block new turn starts. Re-check runs inside the lock and refuse with `busy` if any run is working.
6. Wait for the file to settle (two matching `stat` checks 400 ms apart, up to 10 tries). Read the file fresh and compare the conversation key again. If it changed after the stop, refuse with `changed`.
7. Apply all pending operations in order (refuse with `changed` if an operation no longer applies) and run validation (refuse with `invalid` on any error). Validation refuses an edit that leaves no user or assistant message on the active path, and an edit that makes the conversation end on a system entry. Attachments after the last message are allowed.
8. Write a backup file, write the edited JSONL atomically (`writeFileStringAtomically`), and prune old T3 backups to keep the newest 20. If a write fails, refuse with `writeFailed` and name the backup file.
9. Update `orchestration_v2_turn_item_positions` and append one transaction of projection events: `message.updated`, `turn-item.updated` (with `forkTranscriptHidden: true` for hidden or moved items), `provider-thread.updated` (`nativeConversationHeadRef` set to the last user or assistant entry of the active path, or `null` when none remains), and `provider-turn.updated` (remapping any turn cursor on a removed `uuid` to its nearest kept user or assistant ancestor). Claude resumes only at a user or assistant message, so the head and the cursors never point at an attachment.
10. Release the locks. If the save stopped a working turn and "After the save: Continue the task" is checked (on by default when a turn is working), dispatch the continue prompt.

### Refusals

| Error code                                   | Dialog action                              | Meaning                                                                                          |
| -------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `busy`                                       | Stop and save, Cancel                      | A turn is working or the Claude process is busy                                                  |
| `stale`                                      | Reload, Reload and keep my changes, Cancel | The session file changed after the edit session loaded                                           |
| `changed`                                    | Reload and keep my changes, Cancel         | The file changed during a stop, or a pending operation no longer applies                         |
| `invalid`                                    | Close                                      | Validation found an error such as a broken chain, an orphan tool result, or no conversation left |
| `stopFailed`                                 | Close                                      | The thread did not stop within 20 seconds. The session file is unchanged                         |
| `writeFailed`                                | Close                                      | Writing the backup, session file, or timeline update failed. Names backup                        |
| `not-claude`, `no-session-file`, `badBackup` | Close                                      | Thread is not Claude, has no session file, or named backup is not valid                          |

## Keys

| Shortcut                            | Scope                                                             | Action                                                                            |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Mod+Alt+S`                         | Chat view (`!terminalFocus`, command `forkTranscript.selectMode`) | Toggle Select mode                                                                |
| `Mod+Z`                             | Pending changes and no focused text field (`forkTranscript.undo`) | Undo one transcript step. Falls back to `thread.undo` when no changes are pending |
| `Mod+Shift+Z`                       | Pending changes and no focused text field (`forkTranscript.redo`) | Redo one transcript step                                                          |
| `Mod+Enter`                         | Inside an open edit form                                          | Apply the form changes as one pending step                                        |
| `Escape`                            | Inside an open edit form                                          | Close the edit form without applying                                              |
| `Escape`                            | Select mode (no open dialog, menu, or focused text field)         | First press clears the selection. Second press ends Select mode                   |
| `Mod+A`                             | Select mode with focus in the timeline                            | Select all selectable units                                                       |
| `Shift+ArrowUp` / `Shift+ArrowDown` | Select mode with focus in the timeline                            | Extend the selection up or down                                                   |
| `Alt+ArrowUp` / `Alt+ArrowDown`     | Select mode with focus in the timeline                            | Move the selected units up or down                                                |
| `Delete`                            | Select mode with focus in the timeline                            | Delete the selected units. The next unit becomes the anchor for `Shift+Arrow`     |
| `Shift+click`                       | Select mode on a row or checkbox                                  | Select a range from the anchor to the clicked row                                 |
| Drag over checkboxes                | Select mode                                                       | Select or clear rows along the pointer path with edge auto-scroll                 |
| Drag grip handle                    | Select mode                                                       | Move the dragged unit or full selection before or after another row               |

## Backups

- **Location:** `<stateDir>/fork/transcript-edit/backups/<sessionId>/<YYYYMMDDTHHMMSSZ>.jsonl`.
- **When written:** Before every save and every restore, using atomic file writes.
- **Retention:** The server keeps the 20 newest T3 backups per session (`BACKUPS_KEPT = 20`) and removes older T3 backups after each write.
- **Old editor backups:** Backups from the old standalone editor (`<sessionId>.jsonl.<YYYYMMDDTHHMMSSZ>.bak`) next to the session file are also listed in the thread menu's "Transcript backups" dialog with the "Old editor" badge. You can restore or delete them from the same dialog. T3 does not auto-prune old editor `.bak` files.
- **Restore behavior:** Restoring backs up the current session file first, runs the same stop-and-lock save sequence ("Stop and restore" if busy), re-mirrors the T3 projection with `remirror`, and discards pending edits.

## Limits

- **Inherited rows:** Messages inherited from a parent thread belong to that parent thread. Editing them changes the child thread's session file, while the parent thread rows keep their old text in the timeline. The edit form shows a note and the save toast reports the inherited count.
- **External terminal sessions:** Exit any terminal `claude --resume` session on the same session file before saving. T3 cannot see external terminal processes, and the conversation-key check refuses the save with `stale` if the file changed.
- **Memory-only pending state:** Pending changes stay in memory only. Switching threads keeps pending changes (closing open forms and Select mode). A page reload or app restart drops them.
- **Imported history:** Imported items have no Claude native id. An imported assistant item links to the active-path text entry in the same order with the same text (the importer removes the leading blank lines and the trailing space of each text block, keeps the first-line indentation, and joins blocks with newlines). A fully trimmed text from an older import also matches. The match uses one longest common subsequence, so each item links once and a repeated text links only in its place between other texts. Only run-less items without a native id take part, after the native-id match.
- **Compaction:** Messages before the last compaction are not editable. The compaction item and the `compact_boundary` entry have different ids, so the server pairs the boundary with the last completed Claude compaction item. A compaction that T3 did not see (for example from a terminal session) is not marked, and its rows show the "not linked" reason.
- **Read-only entries and truncation:** Tool calls, tool results, and raw entry fields are read-only. Thinking blocks can be removed, not edited. Preamble, `compact_boundary`, and recovery handoff units are locked. Views cut tool text and raw JSON at 2,000 characters and fetch full text on demand via `fork.transcriptEdit.blockText`. Each request accepts at most 10,000 operations.
- **In-place save only:** Save writes the same session file in place. "Save as copy" and "Save as fork" are out of scope.
- **Earlier sessions:** Messages of an earlier Claude session are not editable, because they are in another session file. The handoff prompt holds their summary for Claude. A thread with a session list marks every turn up to the last recorded earlier session. A thread without one marks every turn up to the last turn whose cursor the current file lacks. Turns without a cursor after that turn count as current.

## Known gaps

- A moved imported assistant message that lands next to a live item gets the run of that item. It then no longer links, because imported items link only when they have no run.
- A moved user unit restored by `remirror` can keep the wrong copy visible.
- `remirror` does not restore the text of an imported assistant item, because the item has no native id. After a restore to a backup with other text, that item keeps its text and does not link.
- An edited user message in imported history is matched by text only.
- A turn queued during a stop makes the save fail after 20 s.
- "Insert above" for a middle unit of a multi-unit work row opens at the row edge with a "Goes before" note.
- `Mod+Alt+S` can clash with AltGr on some keyboard layouts.

## End-to-end test

The e2e test runs the real dev stack (server and web) on a fresh, isolated home and drives the plan checklist in Chromium with Playwright. It calls no model. It is not part of CI.

Run it from the repository root on Windows, with the Vite+ Node on `PATH`:

```powershell
node fork/e2e/transcript-edit/run.ts
```

| Option              | Default                               | Purpose                                                                |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `--dir <folder>`    | `E:/t3fork/e2e` (or `T3FORK_E2E_DIR`) | Parent folder. Each run makes a new `run-<time>` folder in it          |
| `--port-offset <n>` | `4200`                                | Start offset for the dev runner ports (server 13773 + n, web 5733 + n) |
| `--headed`          | off                                   | Show the browser window                                                |

- **Isolation:** The run folder holds the T3 home (`--home-dir`, `--no-seed`, `--no-auto-bootstrap-project-from-cwd`), `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and the workspace. The runner refuses a folder inside `~/.t3`, `~/.claude`, or `~/.claude-pag`. Codex is off in the test settings.
- **Fixtures:** `fixtures.ts` writes two Claude sessions: a chat with thinking, a tool call, and five turns, and a session with a `compact_boundary` entry. The welcome page imports both, so the threads are `import:claudeAgent:<sessionId>`.
- **Checklist:** edit, insert, delete, and move from the edit form, undo and redo, the review dialog, Save with a check of the session file and the backup, four rounds of every Select option (after exit and start, after Discard, after Save), a delete and a move inside a delayed preview, restore of the first backup from the thread menu, and Select mode in the compacted thread, and a delete of every message there that validation blocks (1 error, Save disabled, file unchanged).
- **Result:** The runner prints `PASS` or `FAIL` for each step and exits with 0 or 1. The run folder keeps `e2e.log`, `dev.log`, and `failure.html` for a failed step.

## Files and hook points

### Fork files

| Path                                                            | Responsibility                                                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/forkTranscriptEdit.ts`                  | Operation schemas, view types, item links, Remote Procedure Call (RPC) definitions, and error schema                                                                                      |
| `packages/contracts/src/forkTranscriptEdit.test.ts`             | Contract schema tests                                                                                                                                                                     |
| `apps/server/src/fork/transcriptEdit/core/`                     | Ported JSONL parser, serializer, conversation key, unit model, operations, validation, diff, views                                                                                        |
| `apps/server/src/fork/transcriptEdit/transcriptFiles.ts`        | Session file locator, settle check, atomic writes, T3 and legacy backup management                                                                                                        |
| `apps/server/src/fork/transcriptEdit/itemMap.ts`                | Maps transcript file units to T3 projection turn items (also streamed `message.id` item ids), finds the item of the last compaction, and finds the last item of an earlier Claude session |
| `apps/server/src/fork/transcriptEdit/projectionMirror.ts`       | Plans projection events on save, remaps turn cursors, and re-mirrors on restore                                                                                                           |
| `apps/server/src/fork/transcriptEdit/ForkTranscriptEdit.ts`     | Server service implementing load, preview, save, backups, restore, deleteBackup, and blockText                                                                                            |
| `apps/server/src/fork/transcriptEdit/transcriptEditRpc.ts`      | WebSocket RPC handler bindings for the seven transcript edit methods                                                                                                                      |
| `apps/server/src/fork/transcriptEdit/visibleItems.ts`           | Filters out items with `forkTranscriptHidden: true`                                                                                                                                       |
| `apps/server/src/fork/transcriptEdit/upstreamNames.test.ts`     | Guards upstream symbol names that the fork depends on                                                                                                                                     |
| `apps/web/src/fork/transcriptEdit/`                             | Per-thread edit session atoms, inline edit form, pending markers, save bar, review, backups, Select mode, drag and drop, and Settings row                                                 |
| `apps/web/src/fork/toolCallBackground/foregroundToolContext.ts` | Merges transcript shortcut context flags into shared fork keybinding context                                                                                                              |
| `fork/e2e/transcript-edit/`                                     | End-to-end test: isolated dev stack, fixture sessions, and the Playwright checklist                                                                                                       |
| `fork/features/transcript-edit.md`                              | This feature document                                                                                                                                                                     |

### Upstream hook files

| Upstream file                                                                                 | Hook                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/index.ts`                                                             | Exports `forkTranscriptEdit.ts`                                                                                                |
| `packages/contracts/src/rpc.ts`                                                               | Registers the seven transcript edit RPCs in `WsRpcGroup`                                                                       |
| `packages/contracts/src/clientRpcPermissions.ts`                                              | Maps read methods to read scope and write methods to operate scope                                                             |
| `packages/contracts/src/keybindings.ts`                                                       | Adds `forkTranscript.selectMode`, `forkTranscript.undo`, and `forkTranscript.redo`                                             |
| `packages/contracts/src/orchestrationV2.ts`                                                   | Adds optional `forkTranscriptHidden: true` on turn item base fields                                                            |
| `packages/shared/src/keybindings.ts`                                                          | Adds default transcript keybindings and orders `forkTranscript.undo` ahead of `thread.undo`                                    |
| `apps/server/src/auth/RpcAuthorization.ts` (`RpcAuthorization.test.ts`)                       | Authorizes read and write transcript edit RPC methods                                                                          |
| `apps/server/src/observability/RpcInstrumentation.ts`                                         | Assigns transcript edit RPCs to the `orchestration` aggregate                                                                  |
| `apps/server/src/orchestration-v2/runtimeLayer.ts`                                            | Provides `ForkTranscriptEdit.layer` in the server runtime layer                                                                |
| `apps/server/src/ws.ts` (`ws.test.ts`)                                                        | Mounts `forkTranscriptEditRpcHandlers` in the WebSocket RPC server                                                             |
| `apps/server/src/orchestration-v2/ContextHandoffService.ts` (`ContextHandoffService.test.ts`) | Filters `forkTranscriptHidden` items out of context handoffs and side-chat context                                             |
| `apps/server/src/orchestration-v2/Orchestrator.ts`                                            | Filters `forkTranscriptHidden` items when reading thread turn items                                                            |
| `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`                                | Filters `forkTranscriptHidden` items when building turn-start history                                                          |
| `apps/server/src/keybindings.test.ts`                                                         | Covers the updated default keybindings list                                                                                    |
| `apps/web/src/components/ChatView.tsx`                                                        | Mounts save bar banners, composer send block, backups dialog host, and keyboard commands                                       |
| `apps/web/src/components/Sidebar.tsx`                                                         | Adds Select messages and Transcript backups to the sidebar thread menu                                                         |
| `apps/web/src/components/chat/ThreadTimeline.tsx`                                             | Filters `forkTranscriptHidden` items out of `useTimelineVisibleTurnItems`                                                      |
| `apps/web/src/components/chat/MessagesTimeline.logic.ts`                                      | Passes `groupedEntries` on collapsed work groups so Select mode can select their units                                         |
| `apps/web/src/components/chat/MessagesTimeline.tsx`                                           | Wraps timeline rows in `ForkTranscriptRowFrame`, pins open rows in `alwaysRenderKeys`, and mounts `ForkTranscriptTimelineRoot` |
| `apps/web/src/components/chat/TimelineUserMessageRow.tsx`                                     | Renders `ForkEditRowButton` on user and automation rows                                                                        |
| `apps/web/src/components/chat/TimelineAssistantRows.tsx`                                      | Renders `ForkEditRowButton` on non-streaming assistant rows                                                                    |
| `apps/web/src/components/chat/TimelineWorkEntryRow.tsx`                                       | Renders `ForkEditRowButton` on work entry rows                                                                                 |
| `apps/web/src/components/chat/TimelineWorkGroupRows.tsx`                                      | Renders `ForkEditRowButton` on work group entry rows                                                                           |
| `apps/web/src/components/settings/SettingsPanels.tsx`                                         | Renders `ForkTranscriptEditSettingRow` under General > Display                                                                 |
| `apps/web/src/components/threadActionMenu.logic.ts` (`threadActionMenu.logic.test.ts`)        | Appends fork transcript menu items to thread action menus                                                                      |
| `apps/web/src/hooks/useThreadActionMenu.ts`                                                   | Reads transcript menu state and runs Select mode or backups actions                                                            |
| `apps/web/src/keybindings.test.ts`                                                            | Verifies `Mod+Alt+S`, `Mod+Z`, and `Mod+Shift+Z` resolution                                                                    |

## Turn off

Open **Settings > General > Display** and switch **Transcript editing** off (stored in localStorage under `t3code:fork:transcript-edit:v1`, default `true`).

Turning the setting off hides all Edit buttons, Select mode controls, the save bar, and the thread menu items. The hidden-item filter stays active so previously saved transcript edits remain accurate in the timeline and context handoffs.
