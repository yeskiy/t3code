# Agent Session Import Tools

Two T3 MCP tools let an agent in a T3 thread list Claude Code sessions on disk and import single sessions as T3 threads. The import window in the app imports all sessions of a project folder at once. These tools import only the sessions that the agent names.

## Tools

| Tool                     | Inputs                                                                                                                                      | Output                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `t3_session_import_list` | `providerInstanceId` (only the caller's instance; the default), `projectId` or `workspacePath`, `query`, `limit` (default 20, max 100)      | `providerInstanceId`, `truncated`, and for each session, newest first: `sessionId`, `projectFolder`, `cwd`, `title`, `firstMessage` (200 characters), `messageCount`, `sizeBytes`, `lastChangedAt`, and `thread` or null |
| `t3_session_import`      | `sessionIds` (1 to 20), `providerInstanceId` (only the caller's instance; the default), `projectId`, `asCopy`, `title` (only with `asCopy`) | `providerInstanceId` and for each session: `sessionId`, `status` (`imported`, `already_imported`, `skipped`), `copiedFrom`, `threadId`, `link`, `title`, `projectId`, `reason`                                           |

`thread` in a list item shows the T3 thread that already holds the session: `threadId`, `link`, `title`, `projectId`, `imported` (an `import:` thread), `hasRuns`, and `deleted`.

The default project of an import is the project whose root holds the session `cwd`. The deepest root wins. Pass `projectId` for a session that ran in a linked worktree outside the project root.

### Recovery with `asCopy`

Use `asCopy: true` when a T3 thread broke but its Claude session file is good, or when another thread owns the session. The tool copies the session file to a new random session id in the same folder. It replaces every `sessionId` and `session_id` field that holds the old id. A `title` adds a `custom-title` record to the copy, which names the new thread. Then the tool imports the copy.

- The original file never changes.
- The copy never overwrites a file. The write uses the exclusive `wx` flag.
- If no thread comes from the copy, the tool deletes the copy, so a later scan cannot import it.

## Rules

| Rule                                | How the code applies it                                                                                                                                                                         | Test                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Only the instance `projects` folder | A session id must be a UUID, so it cannot hold `..` or a separator. Each file path goes through `realPath` and must stay inside the real `projects` folder. A link out of the folder is skipped | `sessionFiles.test.ts`                                                         |
| Config folder per instance          | The same resolution as transcript editing: the instance `homePath`, then `CLAUDE_CONFIG_DIR` of the instance environment, then `~/.claude`. A non-Claude instance is refused                    | `ForkAgentSessionImport.test.ts`                                               |
| A session stays on its instance     | A tool reads only the folder of the instance it names, and the thread uses that instance (`import:<instance>:<sessionId>`). A work session never becomes a personal thread                      | `ForkAgentSessionImport.test.ts` ("keeps a work session on the work instance") |
| Only the caller's instance          | A thread can list and import only the sessions of its own instance. A personal thread never sees work session titles or text, and the reverse                                                   | `access.test.ts` (`forkSessionInstance`)                                       |
| An owned session needs `asCopy`     | The tool finds a native thread that owns the session with the same query as the importer's event write, and skips with the reason                                                               | `ForkAgentSessionImport.test.ts`                                               |
| Project conflict and runs           | An `import:` thread in another project, or with runs after its import, is skipped with the reason                                                                                               | `ForkAgentSessionImport.test.ts`                                               |
| Read-only agents only list          | `forkAssertMayImportSessions` refuses an import when the caller's delegation agent has `read-only`. It also refuses when the agent cannot be read                                               | `access.test.ts`, `handlers.test.ts`                                           |
| Broadest access to import           | `t3_session_import` uses `McpToolAccess.writesOwnerWork`, because an import makes a thread that picks its own runtime mode                                                                      | `handlers.test.ts`                                                             |
| Thread callers only                 | Both tools use `McpSchema.EnabledWhen` with `hiddenFromOutsideClients`. Outside MCP clients do not see them                                                                                     | Registration check in `McpToolAccess.toLayer`                                  |
| MCP scope                           | Both tools are in the `threads` group of `forkMcpScope.ts`                                                                                                                                      | `McpScopeGuard.test.ts`                                                        |

## How an import works

1. Resolve the config folder of the instance and find `<sessionId>.jsonl` under `projects`.
2. With `asCopy`, copy the file under a new id.
3. Read the session `cwd` from the first 256 KB and pick the project.
4. Check the owner thread, the project, and the runs.
5. Call `AgentSessionImporter.importRecentAgentThreads` with the picked file. The scanner skips its own discovery and the 30-day window for picked files. All other importer rules apply: the 200-message window, deterministic ids, updates of a thread without runs, and the size budget.
6. Read the thread back and report the result.

## Upstream hooks (`// fork:`)

- `apps/server/src/project/AgentSessionScanner.ts`: `recentThreads` takes an optional list of picked files, which skips discovery and the recent-thread window.
- `apps/server/src/project/AgentSessionImporter.ts`: `importRecentAgentThreads` passes the picked files to the scanner.
- `apps/server/src/mcp/McpHttpServer.ts`: registers the toolkit in `layerTools`.
- `apps/server/src/server.ts`: provides the `ForkAgentSessionImport` service to the MCP layer.
- `apps/server/src/provider/AgentContextBudget.test.ts`: mocks the service. `agentContextBudget.json` holds the larger tool list.
- `packages/contracts/src/forkMcpScope.ts`: adds the tools to the `threads` group.

## Limits

- Only Claude Code sessions. Codex and Pi sessions are not offered.
- The list reads at most 200 session files for a filtered query. `truncated` is true when more files remain.
- The fork end-to-end harness (`fork/e2e/transcript-edit/`) drives the browser and never runs a model turn. An MCP tool call needs a thread with a live run and its own token, so the harness has no step for these tools.
