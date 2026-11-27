# Background Work Stop per Item and Claude Restart Reasons

## Problem

A Claude thread failed every turn with `ClaudeBackgroundWorkBlocksQueryReplacementError` while long background Bash commands (for example `vite` dev servers) ran. Two causes made it worse:

- The live query key held the whole workspace folder list. `RuntimePolicy.ts` reads the project folders from disk on every turn. A new Git repository inside the project root changed the key and asked for a new Claude process. The running background work blocked that process change.
- The error did not say why Claude had to restart or which work blocked it. The **Background work** popup had no Stop for one item. The only way out was Stop for all background work.

## Design

### Query key and folder list (`apps/server/src/fork/claudeRestart/claudeRestart.ts`)

- `claudeEffectiveQueryPolicyKey` keys the workspace on `claudeWorkspaceQueryKey`: the sorted `extraRoots`, or nothing when there are none. Only roots outside `cwd` reach the launch (`additionalDirectories`), so a new folder inside `cwd` keeps the process. A new extra root still asks for a new process.
- `ClaudeLiveQueryContext.workspaceInstructions` holds the `<workspace_folders>` text that the process knows. At launch it is the system prompt text.
- A turn can reuse the process when the text changed. Then `claudeWorkspaceUpdate` adds an app context entry `workspace_folders` to the user message through `withClaudeAppContext`. The model sees `<external_workspace_folders>` with the new list. The known text changes only when the message is offered. A slash command or a resume turn does not carry it, so the next turn carries it.

### Restart reason and blockers

- `ClaudeBackgroundWorkBlocksQueryReplacementError` has optional `reason` (`workspace`, `model`, `permissions`, `mcp`, `other`) and `blocking` (task id, kind `command` or `agent`, description) fields.
- `claudeRestartReason` compares the old and new query keys. It checks in this order: native session or resume (`other`), same key (`model`), `workspace`, `mcpServers` (`mcp`), `runtimePolicy` (`permissions`). A same key means a model or model setting change.
- `claudeRestartBlockingItems` reads the native thread roster (`pendingBackgroundTasksByNativeThread`) and the running subagents of this process (`sessionSubagentsByTaskId`).
- `claudeRestartBlockedMessage` (`packages/contracts/src/forkClaudeRestart.ts`) builds the text, for example: "Claude must restart because the model or its settings changed. These background tasks would end: npx vite preview --port 5318 (command). Wait for them to finish, or stop them, then send the message again." It lists five items, then a count.

### Stop per item

- `fork.toolCall.stopBackgroundTask` (`{ threadId, taskId }`, operate scope) stops one task from a Claude provider thread roster. `ForkToolCallControl.stopBackgroundTask` checks that the task is in the roster of a Claude provider thread of that thread. It refuses a subagent. Then it calls `stopToolCall` with the task id. `ClaudeAdapterV2.stopToolCall` also matches a roster task id and calls `query.stopTask(taskId)`.
- `apps/web/src/fork/backgroundWorkStop/backgroundTaskStop.logic.ts` selects one route for each popup row:

| Item                                                        | Route       | Server path                                                                                                   |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| Claude background command (roster task)                     | `roster`    | `fork.toolCall.stopBackgroundTask`, then `query.stopTask`                                                     |
| Claude command with a running turn item and no roster entry | `tool-call` | `fork.toolCall.stop`                                                                                          |
| Claude native subagent                                      | `subagent`  | `interruptTurn` with `subagentId`, then `subagent.stop` and `stopSubagent`                                    |
| T3 delegated task (`app_owned`)                             | `subagent`  | `interruptTurn` with `subagentId`, then `subagent.stop` and `thread.stop` on the child, as `task_cancel` does |
| Pull request watch, scheduled wakeup, other providers       | none        | No Stop                                                                                                       |

- `ForkBackgroundTaskActions` puts an icon Stop after the status in each popup row, with the tooltip "Stop only this task". It shows a spinner and stays disabled after the server accepts the Stop, until the task leaves the list. A failure shows a toast. Rows without a Stop keep the column, so the statuses line up. Per-item Stop asks for no confirmation, the same as the per-item Stop for subagents, devices, and tool calls.

### Failed run with a blocked restart

- `ForkRestartBlockedActions` shows under the error row of the latest run. The message must start with `CLAUDE_RESTART_BLOCKED_PREFIX`. It lists the live blockers inside the Claude process (roster commands and native subagents, not delegated tasks), each with the same Stop.
- **Stop these and send again** stops every blocker and waits until they leave the pending list (20 seconds at most). Then it sends the failed run's message again with its model selection and the thread modes.

## Hooks in upstream files

| File                                                                                                                       | Hook                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`                                                             | Imports, error fields and message, query key workspace part, `workspaceInstructions` field and launch value, error reason and blockers at the background work guard, folder list update after `openQuery`, folder list commit in `commitOffer`, roster task id match in `stopToolCall` |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`                                                        | The thinking change test matches the new message. New tests for the folder list and a roster Stop                                                                                                                                                                                      |
| `apps/server/src/ws.ts`, `apps/server/src/auth/RpcAuthorization.ts`, `apps/server/src/observability/RpcInstrumentation.ts` | One line each for `stopBackgroundTask`                                                                                                                                                                                                                                                 |
| `packages/contracts/src/rpc.ts`, `packages/contracts/src/clientRpcPermissions.ts`, `packages/contracts/src/index.ts`       | RPC registration, permission, and export                                                                                                                                                                                                                                               |
| `apps/web/src/components/chat/BackgroundWorkDetails.tsx`                                                                   | `ForkBackgroundTaskActions` around the status                                                                                                                                                                                                                                          |
| `apps/web/src/components/chat/TimelineWorkEntryRow.tsx`                                                                    | `ForkRestartBlockedActions` in the error row                                                                                                                                                                                                                                           |

## Limits

- The Stop for a Claude background command calls the Claude Agent SDK `Query.stopTask` (`@anthropic-ai/claude-agent-sdk` 0.3.321). Claude Code ends the shell and sends `task_notification` with status `stopped`. The fork tests check the call with a fake query. They do not run a real Claude process.
- A resend adds a new user message. The failed message stays in the timeline.
