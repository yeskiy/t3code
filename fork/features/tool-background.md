# Move to Background and Stop Running Tool Call

## Problem

When Claude runs a long foreground shell command (Bash or Windows PowerShell) or foreground subagent, the user had no way to detach or kill only that running call without interrupting the entire turn.

## Design

- **Contracts (`packages/contracts/src/forkToolCall.ts`, `rpc.ts`, `clientRpcPermissions.ts`, `keybindings.ts`):**
  - `fork.toolCall.moveToBackground` and `fork.toolCall.stop` RPCs accept `{ threadId, itemId }` and require `AuthOrchestrationOperateScope`.
  - `STATIC_KEYBINDING_COMMANDS` includes `toolCall.moveToBackground` and `toolCall.stop`.
- **Shared keybindings (`packages/shared/src/keybindings.ts`):**
  - `DEFAULT_KEYBINDINGS` binds `mod+b` to `toolCall.moveToBackground` with `when: "foregroundToolRunning && !terminalFocus"`, after `sidebar.toggle`.
  - `toolCall.stop` has no default binding and can be bound in Keybindings Settings.
  - `mergeWithDefaultKeybindings` keeps a conditional `toolCall.moveToBackground` rule after an unconditional `sidebar.toggle` rule on the same chord so existing `keybindings.json` files do not shadow `Ctrl+B`.
- **Server (`apps/server/src/fork/ForkToolCallControl.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`, `RpcAuthorization.ts`, `RpcInstrumentation.ts`, `ws.ts`):**
  - `ClaudeAdapterV2` classifies Windows `PowerShell` tool calls as `command_execution` (matching `Bash`).
  - `ForkToolCallControl` acquires the per-thread lock, verifies the item is a running Claude command (`command_execution`, `PowerShell`/`Bash` `dynamic_tool`) or `subagent`, and calls the adapter with a 15 second timeout.
  - `ClaudeAdapterV2.moveToolCallToBackground` maps a subagent task id to its `runToolUseId` (or uses the command's `tool_use_id`) and calls `query.backgroundTasks(toolUseId)`.
  - `ClaudeAdapterV2.stopToolCall` resolves the task id from `sessionSubagentsByTaskId`, `toolUseIdsByTaskId`, or the thread's pending background task roster, and calls `query.stopTask(taskId)` without interrupting the turn.
- **Web (`apps/web/src/fork/toolCallBackground/*`, `ChatView.tsx`, `TimelineWorkEntryRow.tsx`, `TimelineWorkGroupRows.tsx`, `V2LifecycleRow.tsx`, `keybindings.ts`):**
  - `runningToolCall.logic.ts` detects running Claude commands and `subagent` items across both `work` and `event` timeline entries.
  - `ForkMoveToBackgroundButton` renders **Move to background** and **Stop** (`Stop this command`) buttons on `LiveWorkEntryTimelineRow` (`work-live`), `TimelineWorkEntryRow` (expanded work rows), and `V2LifecycleRow` (`subagent` rows) without nesting buttons.
  - `useForkForegroundToolTracker` publishes the focused thread's newest running movable/stoppable tool call to `foregroundToolContext`, which feeds `foregroundToolRunning` into keybinding resolution.
  - `ChatView` handles `toolCall.moveToBackground` (`Ctrl+B` by default, yielding to rich-text bold when text is selected and to the terminal when focused) and `toolCall.stop` (bindable in settings).
