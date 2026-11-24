# Claude Instance Launch Fields

Per-instance MCP config file merging and a pre-start prepare command for Claude provider instances.

## Problem

The PowerShell Claude wrapper previously handled two launch steps outside T3 Code: running the identity prepare script (TeamClaude pool, transcript editor, work settings sync, secret scanner check) and merging layered MCP JSON files into a single `--mcp-config` file. Moving both steps into Claude provider instance settings lets T3 Code run multiple Claude instances ("Claude" and "Claude (work)") directly without external wrapper syncing.

## Settings

Two Claude-only instance fields are added to `ClaudeSettings` (`packages/contracts/src/forkInstanceLaunch.ts`):

- **MCP config files (`mcpConfigFiles`)**: multi-line text field, one JSON file path per line. Blank lines and `#` comments are ignored. Leading `~` expands against the host home directory.
  - "Claude" (`claudeAgent`):
    - `C:\Users\eqwer\OneDrive\access\.claude\mcp\common.json`
    - `C:\Users\eqwer\OneDrive\access\.claude\mcp\personal.json`
  - "Claude (work)" (`claudeWork`):
    - `C:\Users\eqwer\OneDrive\access\.claude\mcp\common.json`
    - `C:\Users\eqwer\OneDrive\access\.claude\mcp\work.json`
- **Prepare command (`prepareCommand`)**: shell command string executed before each Claude process start.
  - "Claude" (`claudeAgent`): `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\eqwer\OneDrive\access\.claude\scripts\Prepare-Claude.ps1" -Identity personal`
  - "Claude (work)" (`claudeWork`): `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\eqwer\OneDrive\access\.claude\scripts\Prepare-Claude.ps1" -Identity work`

## Behavior

1. **Order in `openQuery`**: `ForkClaudeLaunchResolver.resolve` runs in `Effect.all` alongside `readClaudeAppendSystemPromptFile` and `resolveToolSearchOverride`, before any existing live Claude process is closed. A failure leaves the live process intact and fails the turn before the prompt reaches Claude.
2. **Prepare command**: if `prepareCommand` is non-empty, T3 runs it in a shell (`shell: true`, `extendEnv: false`) in the turn `cwd` (falling back to host home directory) with the instance environment. A per-instance `Semaphore.make(1)` lock serializes concurrent starts.
3. **Timeout and output tail**: the prepare command times out after 120 s (closing its scope kills the shell process without a tree kill, so detached services survive). A non-zero exit fails the turn with `ForkPrepareCommandError` carrying the exit code and the last 20 lines of combined stdout/stderr, capped at 4096 bytes. T3 logs only `exitCode` and `durationMs` (never the command line, environment, or output).
4. **MCP file merge**: if `mcpConfigFiles` lists any files (prepended with any `--mcp-config` path from `launchArgs`), T3 reads each JSON file, requires an object `mcpServers` property, merges them in order so later files win, drops `t3-code`, and atomically writes `<stateDir>/fork/mcp/<instanceId>.json` only when its contents change. A missing, unreadable, invalid JSON, or write-failed file fails the turn with `ForkMcpConfigError` naming only the file path (never file contents).
5. **Query options**: `forkExtraArgsOption` sets `--mcp-config` to the merged file path and strips `disallowedTools`/`disallowed-tools` from `extraArgs` when the fork supplies `disallowedTools`; `forkDisallowedToolsOption` merges upstream and fork `disallowedTools` without duplicates; `appendText` is appended to `systemPrompt.append`.

## Hook points

- `packages/contracts/src/settings.ts:57-60`, `:872-887`: import, spread `ForkClaudeLaunchSettingsFields`, and append `FORK_CLAUDE_LAUNCH_SETTINGS_ORDER` to `ClaudeSettings`.
- `packages/contracts/src/index.ts:85-86`: re-export `./forkInstanceLaunch.ts`.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`:
  1. `:250-257`: import helpers and types from `ForkClaudeLaunch.ts`.
  2. `:2594-2595`: `forkLaunch?: ForkClaudeLaunch` on `makeClaudeQueryOptions` input.
  3. `:2709-2710`: `...forkDisallowedToolsOption(input.disallowedTools, input.forkLaunch)`.
  4. `:2757-2758`: append `input.forkLaunch.appendText` in `systemPrompt.append`.
  5. `:2774-2775`: `...forkExtraArgsOption(extraArgs, input.forkLaunch)`.
  6. `:6052-6053`: `forkClaudeLaunch?: ForkClaudeLaunchResolver` on `ClaudeAdapterV2Options`.
  7. `:13785-13799`: resolve `forkLaunch` in `openQuery` `Effect.all` before closing the live query.
  8. `:13868-13869`: pass `forkLaunch` into `makeClaudeQueryOptions`.
  9. `:15920-15926`: create `forkClaudeLaunch` via `makeForkClaudeLaunchResolver` in `createClaudeAdapterV2`.
- `packages/provider-core/src/server/failure.ts:135-137`: surface `ForkMcpConfigError` and `ForkPrepareCommandError` messages through `curatedCauseMessages`.
- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts:170-172`: treat `ForkMcpConfigError` and `ForkPrepareCommandError` as `refusedBeforePrompt`.
- `apps/server/src/provider/ProviderInstanceRegistry.test.ts:117-119`: include default empty strings for the two new `ClaudeSettings` fields in the test helper.

## Turn off

Leave both **MCP config files** and **Prepare command** empty on the Claude provider instance. With both empty, `resolve` runs no command and writes no MCP file, leaving upstream behavior unchanged.
