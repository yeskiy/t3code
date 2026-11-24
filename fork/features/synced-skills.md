# Claude.ai synced skills

Support skills synced by Claude Code from claude.ai (`<CLAUDE_CONFIG_DIR>/skills/synced/<bucket>/<skill>/SKILL.md`) in Claude sessions and share them into Antigravity and Codex sessions.

## Problem

Claude Code 2.1.331 syncs enabled claude.ai skills per account into `<CLAUDE_CONFIG_DIR>/skills/synced/<orgUuid>_<accountUuid>/`, alongside a `.bucket-<bucket>` marker and `manifest.json`. Upstream T3 Code only discovers synced plugins (`plugins/synced`), so synced skills are missing from Claude's `/` picker and are unavailable to Antigravity and Codex instances.

## Claude Code naming and precedence

Verified against Claude Code 2.1.331 (`claude.exe`):

- Every synced skill folder under `<CLAUDE_CONFIG_DIR>/skills/synced/<bucket>/` (regardless of whether `manifest.json` marks its `source` as `anthropic`, `anthropic-example`, or `plugin`) is registered under the `anthropic-skills:` namespace (`anthropic-skills:<folder>`).
- Folder names containing `:` are skipped, and non-directory metadata files (`manifest.json`, `.last-complete-round`) are ignored.
- The bucket `<orgUuid>_<accountUuid>` (or `<orgUuid>_unbound`) uses the same account resolution as synced plugins and requires `.bucket-<bucket>` in `<CLAUDE_CONFIG_DIR>/skills/synced`.
- `syncClaudeAiSkills: false` hides synced skills when set in user (`settings.json`), local (`.claude/settings.local.json`), or managed (`managed-settings.json`) settings. Shared project settings (`.claude/settings.json`) are ignored, matching Claude Code.
- Managed, user, and project skills with the same bare name win over a synced skill. `skillOverrides` apply by either full (`anthropic-skills:<name>`) or bare (`<name>`) name.

## Sharing into Antigravity and Codex

Both `AntigravitySettings` and `CodexSettings` add `claudeSyncedSkillsInstance` (decoded with default `"claudeAgent"`; empty string `""` turns sharing off; `clearWhenEmpty: "persist"`).

- **Antigravity**: On every session start (`prepareAntigravityProfile`), T3 recomputes the configured Claude instance's synced skill bucket and writes `profileDirectory/config/skills.json` using Antigravity's documented `inherits` (pointing to `~/.gemini/config/skills.json` when present) plus `entries: [{ path: "<bucket>" }]`. Existing symlinks to `~/.gemini/config/skills.json` are unlinked before writing so user files are never modified. A `.t3-fork-synced-skills.json` marker tracks ownership so disabling restores upstream's symlink or copy cleanly. `discoverAntigravitySkills` also scans the bucket after user/project roots so the `/` picker includes synced skills while user skills still win on collision.
- **Codex**: On session initialization (`CodexAdapterV2`) and skill probe (`CodexProvider`), T3 recomputes the bucket and calls `skills/extraRoots/set` when non-empty, ignoring failures on older Codex binaries that do not implement the method.

## Agent registry helper

`apps/server/src/fork/syncedSkills/ClaudeSyncedSkills.ts` exports the pure helper `listClaudeSyncedSkillRoots(configDir, bucket)` returning `[join(configDir, "skills", "synced", bucket.toLowerCase())]`, or `[]` for empty or invalid inputs.

## New fork files

- `apps/server/src/fork/syncedSkills/ClaudeSyncedSkills.ts`
- `apps/server/src/fork/syncedSkills/ClaudeSyncedSkills.test.ts`
- `apps/server/src/fork/syncedSkills/AntigravitySyncedSkills.ts`
- `apps/server/src/fork/syncedSkills/AntigravitySyncedSkills.test.ts`
- `apps/server/src/fork/syncedSkills/AntigravityDriverSyncedSkills.test.ts`
- `apps/server/src/fork/syncedSkills/CodexSyncedSkills.ts`
- `apps/server/src/fork/syncedSkills/CodexSyncedSkills.test.ts`

## Upstream hooks (`// fork:`)

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/settings.test.ts`
- `apps/server/src/provider/Drivers/ClaudeSkills.ts`
- `apps/server/src/provider/Drivers/ClaudeSkills.test.ts`
- `apps/server/src/provider/antigravityAuthSupport.ts`
- `apps/server/src/provider/antigravityAuthSupport.test.ts`
- `apps/server/src/provider/Drivers/AntigravitySkills.ts`
- `apps/server/src/provider/Drivers/AntigravitySkills.test.ts`
- `apps/server/src/provider/Drivers/AntigravityDriver.ts`
- `apps/server/src/provider/Drivers/CodexDriver.ts`
- `apps/server/src/provider/CodexProvider.ts`
- `apps/server/src/provider/ProviderInstanceRegistry.test.ts`
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`
