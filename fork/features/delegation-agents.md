# Delegation Agent Definitions

Provider-neutral agent definitions for delegated child threads across Claude, Antigravity (ACP), and Codex.

## Problem

T3 Code delegates child threads through `delegate_task` across multiple provider drivers. Without a shared agent registry, agent instructions, skill attachments, role defaults, and safety limits would have to be duplicated in provider-specific formats that drift out of sync.

## File format

One agent per Markdown file at `<stateDir>\agents\<name>.md`. The file name without `.md` must equal `name`.

| Key           | Type                                                                              | Meaning                                                                                  |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `name`        | `^[a-z][a-z0-9-]{0,39}$`                                                          | The value of `delegate_task.agent`                                                       |
| `description` | string                                                                            | Shown in `orchestrator_capabilities`                                                     |
| `provider`    | provider instance id (optional)                                                   | Default provider instance when the caller gives no provider or driver                    |
| `roles`       | list of `delegate_task` role values                                               | A task with this role and no `agent` uses this agent. One role maps to one agent at most |
| `limits`      | list of `read-only`, `no-delegation`                                              | Neutral tool limits                                                                      |
| `skills`      | list of skill names                                                               | Inlined after the body, in this order                                                    |
| `defaults`    | map of driver kind (`claudeAgent`, `antigravity`, `codex`) to `{ model, effort }` | Used when the target has no `model`                                                      |
| body          | Markdown                                                                          | The agent instructions                                                                   |

When an agent sets `provider` and the caller gives no provider or driver, T3 uses that instance and fails if it is unavailable.

The rendered agent text delivered to a child thread:

```text
## T3 agent: <name>

<body>

Limits: <read-only: do not create, edit, or delete files.> <no-delegation: do not delegate, do the work yourself.>

### Skill: <skill name>

<SKILL.md without its frontmatter>
```

When an agent declares no `limits`, the `Limits:` paragraph is omitted.

## Where T3 reads files

- **Agent files:** `<stateDir>\agents` (only `*.md` files, sorted by name). A missing directory returns an empty list.
- **Skill roots (in search order, first match wins):**
  1. `~\.claude\skills\<name>\SKILL.md`
  2. `~\.agents\skills\<name>\SKILL.md`
  3. `~\.gemini\config\skills\<name>\SKILL.md`
- **Size cap:** the rendered agent text (header, body, limits, and inlined skills) must be `32768` bytes (32 KB) or less (`FORK_AGENT_TEXT_MAX_BYTES`). Larger agents fail `resolveForTask` and `forThread`.

## Role mapping

- An explicit `agent` name on `delegate_task` always wins over `role`.
- When `agent` is omitted and `role` is provided, T3 selects the agent whose `roles` list includes that role.
- If no agent claims the role, no agent definition is applied.
- Each role may appear in at most one agent file; duplicate claims fail `list`.

## Limits per driver

| Limit           | Claude                                                                        | Antigravity (ACP) | Codex     | MCP (`delegate_task`)                                   |
| --------------- | ----------------------------------------------------------------------------- | ----------------- | --------- | ------------------------------------------------------- |
| `read-only`     | Adds `Write`, `Edit`, `NotebookEdit` to `--disallowedTools` and includes text | Text only         | Text only | Allowed                                                 |
| `no-delegation` | Adds `Agent` to `--disallowedTools` and includes text                         | Text only         | Text only | Rejects `delegate_task` from the child for every driver |

## Side store

Child thread to agent mappings are stored in `<stateDir>\fork\delegation-agents.json` (JSON `{ version: 1, threads: { [threadId]: { agent, at } } }`).

- Loaded once when `ForkDelegationAgents` starts and kept in memory.
- Updated atomically on `record`, serialized by a single-permit semaphore.
- Retains the 5,000 newest entries sorted by `at`.

## Hook points

| Upstream file                                                    | Hook                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/index.ts`                                | Re-export `forkDelegationAgent.ts`                                                                                                                           |
| `packages/contracts/src/orchestratorMcp.ts`                      | `agent` on `OrchestratorMcpDelegateTaskInput`, `agents` on `OrchestratorMcpCapabilitiesResult`                                                               |
| `packages/provider-core/src/server/ProviderAdapter.ts`           | `forkAgent` on `ProviderAdapterV2TurnInput`                                                                                                                  |
| `packages/provider-core/src/server/orchestrationInstructions.ts` | `forkAgentInstructions` on `T3AcpInstructionState` and `t3AcpPromptWithInstructions`                                                                         |
| `packages/provider-acp/src/server/adapter.ts`                    | Pass `turnInput.forkAgent.instructions` into `instructionState`                                                                                              |
| `apps/server/src/mcp/OrchestratorMcpService.ts`                  | List `agents` in `capabilities`, enforce `no-delegation` on local and remote `delegateTask`, resolve agent and defaults, record child thread before dispatch |
| `apps/server/src/mcp/toolkits/orchestrator/tools.ts`             | Set `anthropic/alwaysLoad` on `orchestrator_capabilities`, `delegate_task`, `task_status`, and `task_cancel` so Claude Code loads them without ToolSearch    |
| `apps/server/src/orchestration-v2/RunExecutionService.ts`        | Load `forkAgent` for the run's thread and attach to `turnInput` (log and skip on broken definition)                                                          |
| `apps/server/src/orchestration-v2/runtimeLayer.ts`               | Provide `ForkDelegationAgents.layer` to `RunExecutionService` and expose it from `layer` so `OrchestratorMcpService` shares the same memoized instance       |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`   | Pass `forkClaudeAgentParts(turnInput.forkAgent)` into `forkClaudeLaunch.resolve`                                                                             |
| `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`    | Spread `forkCodexAgentContext(input.forkAgent)` into `additionalContext` and pass `turnInput.forkAgent` in `startNativeTurn`                                 |
| `apps/server/src/provider/agentContextBudget.json`               | Account for the `agent` field on `delegate_task` (+26 bytes)                                                                                                 |

## Turn off

Empty the `<stateDir>\agents` folder. No agent then resolves, and `delegate_task` works as upstream.
