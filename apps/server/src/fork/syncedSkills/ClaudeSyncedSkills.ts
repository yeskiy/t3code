// @effect-diagnostics-next-line nodeBuiltinImport:off - listClaudeSyncedSkillRoots is a pure synchronous helper for callers outside Effect.
import * as NodePath from "node:path";

import { ClaudeSettings, type ServerSettings } from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  claudeAccountConfigPath,
  readClaudeOauthAccount,
} from "../../provider/claudeResetCredits.ts";

export const CLAUDE_SYNCED_SKILL_PREFIX = "anthropic-skills";
export const DEFAULT_CLAUDE_SYNCED_SKILLS_INSTANCE = "claudeAgent";

const ACCOUNT_UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SYNCED_BUCKET_PATTERN =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}_(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|unbound)$/i;

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeSyncedSkillToggle = Schema.decodeUnknownEffect(
  fromLenientJson(Schema.Struct({ syncClaudeAiSkills: Schema.optional(Schema.Unknown) })),
);

/** Pure helper returning the synced skill root for a Claude config directory and account bucket. */
export function listClaudeSyncedSkillRoots(
  configDir: string,
  bucket: string | undefined,
): ReadonlyArray<string> {
  const trimmedConfigDir = configDir.trim();
  const trimmedBucket = bucket?.trim();
  if (!trimmedConfigDir || !trimmedBucket || !SYNCED_BUCKET_PATTERN.test(trimmedBucket)) {
    return [];
  }
  return [NodePath.join(trimmedConfigDir, "skills", "synced", trimmedBucket.toLowerCase())];
}

function windowsEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = name.toLowerCase();
  return Object.entries(environment)
    .find(([candidate]) => candidate.toLowerCase() === key)?.[1]
    ?.trim();
}

function claudeManagedSettingsPaths(
  path: Path.Path,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
  if (platform === "darwin") {
    return ["/Library/Application Support/ClaudeCode/managed-settings.json"];
  }
  if (platform === "win32") {
    const programData = windowsEnvironmentValue(environment, "ProgramData");
    const programFiles = windowsEnvironmentValue(environment, "ProgramFiles");
    return [
      ...(programData ? [path.join(programData, "ClaudeCode", "managed-settings.json")] : []),
      ...(programFiles ? [path.join(programFiles, "ClaudeCode", "managed-settings.json")] : []),
    ];
  }
  return ["/etc/claude-code/managed-settings.json"];
}

const findRepositoryRoot = Effect.fnUntraced(function* (
  cwd: string,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const walk = (current: string): Effect.Effect<string | undefined> =>
    fileSystem.exists(path.join(current, ".git")).pipe(
      Effect.orElseSucceed(() => false),
      Effect.flatMap((isRoot) => {
        if (isRoot) return Effect.succeed(current);
        const parent = path.dirname(current);
        return parent === current ? Effect.undefined : walk(parent);
      }),
    );
  return yield* walk(path.resolve(cwd));
});

const resolveConfigDirPath = Effect.fn("ClaudeSyncedSkills.resolveConfigDirPath")(function* (
  homePath: string,
  environment: NodeJS.ProcessEnv,
  cwd?: string,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const trimmedHomePath = homePath.trim();
  if (trimmedHomePath.length > 0) {
    return path.resolve(expandHomePath(trimmedHomePath, home));
  }
  const envConfigDir = environment.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (envConfigDir.length > 0) {
    return cwd ? path.resolve(cwd, envConfigDir) : path.resolve(envConfigDir);
  }
  return path.join(home, ".claude");
});

const isSyncedSkillsHidden = Effect.fn("ClaudeSyncedSkills.isSyncedSkillsHidden")(function* (
  configDirPath: string,
  cwd: string | undefined,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const repositoryRoot = cwd === undefined ? undefined : yield* findRepositoryRoot(cwd);
  const root = repositoryRoot !== undefined && repositoryRoot !== cwd ? repositoryRoot : undefined;
  // Shared project settings (.claude/settings.json) cannot disable syncClaudeAiSkills.
  const settingsPaths = [
    path.join(configDirPath, "settings.json"),
    ...(cwd ? [path.join(cwd, ".claude", "settings.local.json")] : []),
    ...(root ? [path.join(root, ".claude", "settings.local.json")] : []),
    ...claudeManagedSettingsPaths(path, platform, environment),
  ];
  for (const settingsPath of settingsPaths) {
    const contents = yield* fileSystem
      .readFileString(settingsPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) continue;
    const parsed = yield* decodeSyncedSkillToggle(contents).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (parsed?.syncClaudeAiSkills === false) {
      return true;
    }
  }
  return false;
});

/** Resolves the `<org>_<account>` bucket for a Claude config directory and environment. */
const resolveClaudeSyncedSkillBucket = Effect.fn(
  "ClaudeSyncedSkills.resolveClaudeSyncedSkillBucket",
)(function* (
  config: Pick<ClaudeSettings, "homePath">,
  configDirPath: string,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const accountConfigPath = yield* claudeAccountConfigPath(
    config.homePath.trim() || environment.CLAUDE_CONFIG_DIR?.trim() ? configDirPath : undefined,
  );
  const account = yield* readClaudeOauthAccount(accountConfigPath);
  const organizationId = environment.CLAUDE_CODE_ORGANIZATION_UUID ?? account?.organizationUuid;
  const environmentAccountId = environment.CLAUDE_CODE_ACCOUNT_UUID;
  const accountId =
    account !== undefined && !environment.CLAUDE_CODE_OAUTH_TOKEN
      ? typeof account.accountUuid === "string"
        ? account.accountUuid
        : undefined
      : environmentAccountId && ACCOUNT_UUID_PATTERN.test(environmentAccountId)
        ? environmentAccountId
        : "unbound";
  if (
    !organizationId ||
    !accountId ||
    !ACCOUNT_UUID_PATTERN.test(organizationId) ||
    (accountId !== "unbound" && !ACCOUNT_UUID_PATTERN.test(accountId))
  ) {
    return undefined;
  }
  return `${organizationId.toLowerCase()}_${accountId.toLowerCase()}`;
});

/** Returns the existing synced skill bucket root when its `.bucket-<id>` marker is present. */
export const discoverClaudeSyncedSkillRoots = Effect.fn(
  "ClaudeSyncedSkills.discoverClaudeSyncedSkillRoots",
)(function* (
  configDirPath: string,
  syncedBucket: string | undefined,
): Effect.fn.Return<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
  const candidates = listClaudeSyncedSkillRoots(configDirPath, syncedBucket);
  const bucketPath = candidates[0];
  if (bucketPath === undefined || syncedBucket === undefined) {
    return [];
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const normalizedBucket = syncedBucket.trim().toLowerCase();
  const markerPath = path.join(configDirPath, "skills", "synced", `.bucket-${normalizedBucket}`);
  const hasMarker = yield* fileSystem.exists(markerPath).pipe(Effect.orElseSucceed(() => false));
  if (!hasMarker) {
    return [];
  }
  const bucketInfo = yield* fileSystem.stat(bucketPath).pipe(Effect.orElseSucceed(() => undefined));
  return bucketInfo?.type === "Directory" ? [bucketPath] : [];
});

/** Resolves the synced skill roots to share from a named Claude provider instance. */
export const resolveSyncedSkillsForClaudeInstance = Effect.fn(
  "ClaudeSyncedSkills.resolveSyncedSkillsForClaudeInstance",
)(function* (input: {
  readonly claudeInstanceId: string;
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly hostEnvironment: NodeJS.ProcessEnv;
  readonly cwd?: string | undefined;
}): Effect.fn.Return<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
  const instanceId = input.claudeInstanceId.trim();
  if (instanceId.length === 0) {
    return [];
  }
  const entry = Object.hasOwn(input.settings.providerInstances, instanceId)
    ? input.settings.providerInstances[instanceId as keyof typeof input.settings.providerInstances]
    : undefined;
  if (entry !== undefined && entry.driver !== "claudeAgent") {
    return [];
  }
  if (entry === undefined && instanceId !== DEFAULT_CLAUDE_SYNCED_SKILLS_INSTANCE) {
    return [];
  }

  const decodedConfig =
    entry !== undefined
      ? Option.getOrUndefined(decodeClaudeSettings(entry.config ?? {}))
      : undefined;
  const homePath = decodedConfig?.homePath ?? "";
  const environment: NodeJS.ProcessEnv = { ...input.hostEnvironment };
  for (const variable of entry?.environment ?? []) {
    if (typeof variable.value === "string") {
      environment[variable.name] = variable.value;
    }
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDirPath = yield* resolveConfigDirPath(homePath, environment, input.cwd);
  const hidden = yield* isSyncedSkillsHidden(configDirPath, input.cwd, environment);
  if (hidden) {
    return [];
  }
  const hasSyncedDir = yield* fileSystem
    .exists(path.join(configDirPath, "skills", "synced"))
    .pipe(Effect.orElseSucceed(() => false));
  if (!hasSyncedDir) {
    return [];
  }
  const syncedBucket = yield* resolveClaudeSyncedSkillBucket(
    { homePath },
    configDirPath,
    environment,
  );
  return yield* discoverClaudeSyncedSkillRoots(configDirPath, syncedBucket);
});
