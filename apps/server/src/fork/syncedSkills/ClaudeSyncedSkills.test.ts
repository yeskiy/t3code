import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CLAUDE_SYNCED_SKILL_PREFIX,
  DEFAULT_CLAUDE_SYNCED_SKILLS_INSTANCE,
  discoverClaudeSyncedSkillRoots,
  listClaudeSyncedSkillRoots,
  resolveSyncedSkillsForClaudeInstance,
} from "./ClaudeSyncedSkills.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

const ORG_ID = "11111111-2222-4333-8444-555555555555";
const ACCOUNT_A = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const ACCOUNT_B = "77777777-8888-4999-aaaa-bbbbbbbbbbbb";

const writeBucket = Effect.fn("writeSyncedSkillsBucket")(function* (
  configDir: string,
  bucket: string,
  skillNames: ReadonlyArray<string>,
  options: { readonly marker?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const syncedDir = path.join(configDir, "skills", "synced");
  const bucketDir = path.join(syncedDir, bucket);
  yield* fs.makeDirectory(bucketDir, { recursive: true });
  for (const skillName of skillNames) {
    const skillDir = path.join(bucketDir, skillName);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Synced ${skillName}.\n---\n`,
    );
  }
  yield* fs.writeFileString(
    path.join(bucketDir, "manifest.json"),
    JSON.stringify({
      lastUpdated: 1795540246671,
      skills: skillNames.map((name) => ({ skillId: name, name, source: "anthropic" })),
    }),
  );
  if (options.marker !== false) {
    yield* fs.writeFileString(path.join(syncedDir, `.bucket-${bucket}`), "");
  }
  return bucketDir;
});

it.layer(NodeServices.layer)("ClaudeSyncedSkills", (it) => {
  it.effect("exports the expected prefix and default Claude instance ID", () =>
    Effect.sync(() => {
      assert.strictEqual(CLAUDE_SYNCED_SKILL_PREFIX, "anthropic-skills");
      assert.strictEqual(DEFAULT_CLAUDE_SYNCED_SKILLS_INSTANCE, "claudeAgent");
    }),
  );

  it.effect("computes pure synced skill roots and rejects invalid buckets", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const configDir = path.join("tmp", "claude-home");
      const upperBucket = `${ORG_ID.toUpperCase()}_${ACCOUNT_A.toUpperCase()}`;
      const expectedLower = `${ORG_ID}_${ACCOUNT_A}`;

      assert.deepEqual(listClaudeSyncedSkillRoots(configDir, upperBucket), [
        path.join(configDir, "skills", "synced", expectedLower),
      ]);
      assert.deepEqual(listClaudeSyncedSkillRoots(configDir, `${ORG_ID}_unbound`), [
        path.join(configDir, "skills", "synced", `${ORG_ID}_unbound`),
      ]);
      assert.deepEqual(listClaudeSyncedSkillRoots("", expectedLower), []);
      assert.deepEqual(listClaudeSyncedSkillRoots("   ", expectedLower), []);
      assert.deepEqual(listClaudeSyncedSkillRoots(configDir, undefined), []);
      assert.deepEqual(listClaudeSyncedSkillRoots(configDir, ""), []);
      assert.deepEqual(listClaudeSyncedSkillRoots(configDir, "../escape"), []);
      assert.deepEqual(listClaudeSyncedSkillRoots(configDir, "not-a-bucket"), []);
    }),
  );

  it.effect("discovers synced skill roots only when both marker and bucket folder exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const configDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-synced-skills-" });
      const bucket = `${ORG_ID}_${ACCOUNT_A}`;

      assert.deepEqual(yield* discoverClaudeSyncedSkillRoots(configDir, undefined), []);
      assert.deepEqual(yield* discoverClaudeSyncedSkillRoots(configDir, bucket), []);

      const withoutMarker = `${ORG_ID}_${ACCOUNT_B}`;
      yield* writeBucket(configDir, withoutMarker, ["pdf"], { marker: false });
      assert.deepEqual(yield* discoverClaudeSyncedSkillRoots(configDir, withoutMarker), []);

      const bucketDir = yield* writeBucket(configDir, bucket, ["docx"]);
      assert.deepEqual(yield* discoverClaudeSyncedSkillRoots(configDir, bucket), [bucketDir]);
    }),
  );

  it.effect("resolves synced skills for configured, default, and disabled Claude instances", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-synced-resolve-" });
      const defaultClaudeDir = path.join(tempDir, "claude-default");
      const altClaudeDir = path.join(tempDir, "claude-alt");
      const workspace = path.join(tempDir, "workspace");
      yield* fs.makeDirectory(path.join(workspace, ".claude"), { recursive: true });

      const bucketA = yield* writeBucket(defaultClaudeDir, `${ORG_ID}_${ACCOUNT_A}`, ["docx"]);
      yield* fs.writeFileString(
        path.join(defaultClaudeDir, ".claude.json"),
        JSON.stringify({
          oauthAccount: { organizationUuid: ORG_ID, accountUuid: ACCOUNT_A },
        }),
      );

      const bucketB = yield* writeBucket(altClaudeDir, `${ORG_ID}_${ACCOUNT_B}`, ["pdf"]);
      yield* fs.writeFileString(
        path.join(altClaudeDir, ".claude.json"),
        JSON.stringify({
          oauthAccount: { organizationUuid: ORG_ID, accountUuid: ACCOUNT_B },
        }),
      );

      const settings = decodeServerSettings({
        providerInstances: {
          claudeAgent: {
            driver: ProviderDriverKind.make("claudeAgent"),
            config: { homePath: defaultClaudeDir },
          },
          "claude-alt": {
            driver: ProviderDriverKind.make("claudeAgent"),
            config: { homePath: altClaudeDir },
          },
          codex: {
            driver: ProviderDriverKind.make("codex"),
          },
        },
      });

      const resolve = (
        claudeInstanceId: string,
        overrideSettings = settings,
        env: NodeJS.ProcessEnv = {},
        cwd?: string,
      ) =>
        resolveSyncedSkillsForClaudeInstance({
          claudeInstanceId,
          settings: overrideSettings,
          hostEnvironment: env,
          cwd,
        }).pipe(Effect.provideService(HostProcess.Platform, "win32"));

      // Empty instance ID turns sharing off.
      assert.deepEqual(yield* resolve(""), []);
      assert.deepEqual(yield* resolve("   "), []);

      // Default and named Claude instances resolve their own account buckets.
      assert.deepEqual(yield* resolve("claudeAgent"), [bucketA]);
      assert.deepEqual(yield* resolve("claude-alt"), [bucketB]);

      // Unknown or non-Claude instance returns no roots.
      assert.deepEqual(yield* resolve("missing-instance"), []);
      assert.deepEqual(yield* resolve("codex"), []);

      // Unconfigured default claudeAgent falls back to CLAUDE_CONFIG_DIR.
      const emptySettings = decodeServerSettings({});
      assert.deepEqual(
        yield* resolve("claudeAgent", emptySettings, { CLAUDE_CONFIG_DIR: defaultClaudeDir }),
        [bucketA],
      );

      // Shared project settings cannot hide synced skills, while local and user settings do.
      yield* fs.writeFileString(
        path.join(workspace, ".claude", "settings.json"),
        '{"syncClaudeAiSkills":false}',
      );
      assert.deepEqual(yield* resolve("claudeAgent", settings, {}, workspace), [bucketA]);

      yield* fs.writeFileString(
        path.join(workspace, ".claude", "settings.local.json"),
        '{"syncClaudeAiSkills":false}',
      );
      assert.deepEqual(yield* resolve("claudeAgent", settings, {}, workspace), []);

      yield* fs.writeFileString(
        path.join(defaultClaudeDir, "settings.json"),
        '{"syncClaudeAiSkills":false}',
      );
      assert.deepEqual(yield* resolve("claudeAgent"), []);

      // Non-secret instance environment overrides CLAUDE_CODE_ACCOUNT_UUID when OAuth token is set.
      const envSettings = decodeServerSettings({
        providerInstances: {
          [ProviderInstanceId.make("claude-env")]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            config: { homePath: altClaudeDir },
            environment: [
              { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "tok" },
              { name: "CLAUDE_CODE_ORGANIZATION_UUID", value: ORG_ID },
              { name: "CLAUDE_CODE_ACCOUNT_UUID", value: ACCOUNT_B },
            ],
          },
        },
      });
      assert.deepEqual(yield* resolve("claude-env", envSettings), [bucketB]);
    }),
  );
});
