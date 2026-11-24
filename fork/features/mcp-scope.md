# Per-provider MCP tool scope

Control which T3 Code MCP tool groups each provider instance receives, up to turning the T3 MCP server off for a provider.

## Problem

T3 Code registers 95 MCP tools on `/mcp` and injects the `t3-code` MCP server into every agent session it starts. Users may want to reduce context size, keep an agent focused on local coding tools, or turn T3 Code's MCP integration off for a specific provider.

## How tools reach providers today

1. `ProviderSessionManager.prepareMcpSession` issues a per-thread bearer token from `McpSessionRegistry` and writes a `McpProviderSessionConfig` into `McpProviderSessions`.
2. Each provider adapter reads `McpProviderSessions.read(threadId)` and injects `t3-code` if a config is present:
   - **Claude** (`ClaudeAdapterV2`): adds `mcpServers["t3-code"]` (HTTP) and `allowedTools` (`mcp__t3-code__*` or read-only subset).
   - **Codex** (`CodexAdapterV2`): adds `mcp_servers.t3-code` and `mcp_servers.t3-code-direct` (HTTP) plus developer instructions.
   - **ACP providers** (`packages/provider-acp`, used by Antigravity, Kiro, Grok, fx, and ACP Registry): adds stdio bridge (`acp-mcp-bridge`), optional HTTP server (with `t3-tool-exposure: deferred` for Copilot), `T3_ACP_MCP_*` environment variables, and prompt instructions.
   - **Cursor** (`packages/provider-cursor`): adds `mcpServers` and prompt instructions.
   - **OpenCode** (`packages/provider-opencode`): registers a remote MCP server via OpenCode's runtime API and appends system instructions.
   - **Muse** (`packages/provider-muse`): passes `config.mcpServers["t3-code"]` (`streamableHttp`, `mode: "optional"`).
   - **Pi** (`packages/provider-pi`): injects `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN` into its T3 MCP extension.
3. All providers already omit the `t3-code` MCP server and its instructions when `McpProviderSessions.read(threadId)` returns `undefined`.

## Storage choice

Scopes are stored on `ServerSettings.forkMcpScopes` in `settings.json`, keyed by `ProviderInstanceId`.

Why this storage:

- Zero new WebSocket RPCs, zero changes to `ws.ts`, `http.ts`, `rpc.ts`, `RpcAuthorization.ts`, or `server.ts`.
- Both `McpHttpServer` and `ProviderSessionManager` already depend on `ServerSettingsService`.
- Settings sync across web, desktop, and remote clients automatically, write atomically, strip defaults (`Full` stores no entry), and enforce `AuthSettingsWriteScope`.
- Upstream builds ignore unknown keys in `settings.json`, keeping the file compatible.

## Core tools and tool groups

When a provider is not set to `Off`, three core tools stay available:

- `send_to_user`: delivers mid-turn text verbatim (required on Claude 5.1+ where pre-tool text is summarized).
- `t3_submit_output`: lets an agent submit structured output when a run declares `outputSchema`.
- `tool_search`: lets deferring harnesses (such as GitHub Copilot ACP) load enabled tools on demand. Non-deferring clients do not see it.

When a provider is set to `Off`, the T3 MCP server is not attached at all and all tools, including core tools, are hidden and rejected.

| Group ID         | Label                         | Tools                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delegation`     | Delegation and background (7) | `orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel`, `t3_workflow`, `t3_workflow_stop`, `t3_background_wait`                                                                                                                                                                                                                                                                             |
| `threads`        | Threads and attachments (17)  | `create_threads`, `t3_thread_launch`, `t3_thread_list`, `t3_thread_read`, `t3_thread_update`, `t3_thread_send`, `t3_thread_wait`, `t3_thread_interrupt`, `t3_thread_organize`, `t3_queue`, `t3_pending_request`, `t3_thread_configure`, `t3_thread_transfer`, `t3_thread_search`, `t3_attachment_prepare_upload`, `t3_attachment_discard`, `t3_thread_send_attachments`                                         |
| `projects`       | Projects (6)                  | `t3_project_list`, `t3_project_read`, `t3_project_create`, `t3_project_update`, `t3_project_delete`, `t3_project_clone`                                                                                                                                                                                                                                                                                         |
| `worktrees`      | Worktrees (3)                 | `t3_worktree_handoff`, `t3_worktree_status`, `t3_worktree_list`                                                                                                                                                                                                                                                                                                                                                 |
| `preview`        | Browser preview (14)          | `preview_status`, `preview_open`, `preview_dialog`, `preview_navigate`, `preview_resize`, `preview_set_appearance`, `preview_snapshot`, `preview_act`, `preview_evaluate`, `preview_wait_for`, `preview_recording_start`, `preview_recording_stop`, `t3_preview_list`, `t3_preview_close`                                                                                                                       |
| `html`           | HTML visuals (2)              | `html_preview`, `html_render`                                                                                                                                                                                                                                                                                                                                                                                   |
| `devices`        | Devices (4)                   | `device_list`, `device_open`, `device_screenshot`, `device_close`                                                                                                                                                                                                                                                                                                                                               |
| `pullRequests`   | Pull requests and CI (18)     | `link_pull_request`, `link_pull_requests`, `unlink_pull_request`, `unlink_pull_requests`, `list_thread_pull_requests`, `watch_pull_request`, `unwatch_pull_request`, `write_pull_request_guides`, `read_pull_request_guide`, `pull_request_read`, `pull_request_list`, `pull_request_create`, `pull_request_update`, `pull_request_respond`, `pull_request_review`, `pull_request_merge`, `ci_logs`, `ci_rerun` |
| `issues`         | Issues (8)                    | `list_issues`, `read_issue`, `create_issue`, `comment_on_issue`, `set_issue_state`, `link_issue`, `unlink_issue`, `list_thread_issues`                                                                                                                                                                                                                                                                          |
| `secrets`        | Secret requests (1)           | `request_secret`                                                                                                                                                                                                                                                                                                                                                                                                |
| `scheduledTasks` | Scheduled tasks (4)           | `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `run_scheduled_task_now`                                                                                                                                                                                                                                                                                                                      |
| `environments`   | Environments (6)              | `t3_environment_read`, `t3_environment_preferences_update`, `t3_environment_links`, `t3_environment_link`, `t3_environment_unlink`, `t3_feedback`                                                                                                                                                                                                                                                               |
| `themes`         | Themes (2)                    | `t3_theme_read`, `t3_theme_set`                                                                                                                                                                                                                                                                                                                                                                                 |

## Presets

- **Full** (default): all 13 groups and core tools. Existing environment, project, forge, and subagent restrictions still apply.
- **Standard**: `worktrees`, `preview`, `html`, `devices`, `pullRequests`, `issues`, `secrets`, and core tools. Disables cross-thread orchestration (`delegation`, `threads`), project management (`projects`), `scheduledTasks`, `environments`, and `themes`.
- **Minimal**: core tools only (`send_to_user`, `t3_submit_output`, `tool_search`).
- **Off**: no T3 MCP server injected into sessions; any existing session sees an empty tool list and every `tools/call` fails.

Toggling individual switches selects **Custom** whenever the enabled groups do not match a preset.

## Server enforcement

1. **HTTP MCP boundary (`McpScopeGuard.layerForkMcpScope`)**: registered globally in `McpHttpServer.layerMcpTransport` via `McpServer.visibility`. It checks every `tools/list` and `tools/call` request for thread callers against `ServerSettingsService`. Disabled tools disappear from `tools/list` and fail `tools/call` with MCP `-32602` (`InvalidParams`), including on live sessions that cached an earlier list. Unreadable settings fail closed (`Off`). Outside MCP clients (OAuth/CLI/peer links) are unaffected.
2. **Deferred tool search (`McpToolExposure.search`)**: `tool_search` filters candidates with the same provider scope so disabled tools are never discovered or loaded.
3. **Session setup (`ProviderSessionManager.prepareMcpSession`)**: when a provider is `Off`, T3 revokes any existing thread token and clears `McpProviderSessions` so the adapter launches without T3 MCP. When `preview` or `devices` is disabled, those capabilities are stripped before issuing the credential so adapters also omit browser and device prompt instructions.

## Settings UI

Available in **Settings > Providers > Agent integration** (`apps/web/src/fork/mcpScope/ForkMcpScopeSection.tsx`). Users pick a provider instance, choose a preset (`Full`, `Standard`, `Minimal`, `Off`), toggle individual tool groups, inspect the exact tool names per group, or reset a provider back to `Full`.

## Upstream hooks (`// fork:`)

- `packages/contracts/src/index.ts`
- `packages/contracts/src/settings.ts`
- `packages/shared/src/serverSettings.ts`
- `apps/server/src/mcp/McpHttpServer.ts`
- `apps/server/src/mcp/McpToolExposure.ts`
- `apps/server/src/mcp/toolkits/toolSearch/handlers.ts`
- `apps/server/src/orchestration-v2/ProviderSessionManager.ts`
- `apps/web/src/components/settings/ProviderSettingsPanel.tsx`
