import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const SYNCED_SKILLS_MARKER_FILE = ".t3-fork-synced-skills.json";
const RULE_COPIES_FILE = ".t3-rule-copies.json";
const SKILLS_CONFIG_KEY = "config/skills.json";

const RuleCopiesJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const decodeRuleCopies = Schema.decodeUnknownOption(RuleCopiesJson);
const SkillsConfigEntry = Schema.Struct({ path: Schema.String });
const SkillsConfigFile = Schema.Struct({
  inherits: Schema.optional(Schema.Array(SkillsConfigEntry)),
  entries: Schema.Array(SkillsConfigEntry),
});
const encodeSkillsConfig = Schema.encodeSync(Schema.fromJsonString(SkillsConfigFile, { space: 2 }));

function formatAntigravityConfigPath(rawPath: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? rawPath.replaceAll("\\", "/") : rawPath;
}

/**
 * Manages profile `config/skills.json` when synced Claude skills are shared into Antigravity.
 * Returns true when this helper owns `config/skills.json`, false to leave it to upstream.
 */
export const prepareAntigravitySyncedSkillsConfig = Effect.fn(
  "prepareAntigravitySyncedSkillsConfig",
)(function* (input: {
  readonly profileDirectory: string;
  readonly userHome: string;
  readonly platform: NodeJS.Platform;
  readonly extraSkillRoots: ReadonlyArray<string>;
}): Effect.fn.Return<boolean, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileSkillsJson = path.join(input.profileDirectory, "config", "skills.json");
  const userSkillsJson = path.join(input.userHome, ".gemini", "config", "skills.json");
  const markerPath = path.join(input.profileDirectory, SYNCED_SKILLS_MARKER_FILE);
  const ruleCopiesPath = path.join(input.profileDirectory, RULE_COPIES_FILE);

  const readOptional = (filePath: string) =>
    fs.readFileString(filePath).pipe(Effect.orElseSucceed((): string | undefined => undefined));
  const isSymlink = (filePath: string) =>
    fs.readLink(filePath).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  const previousManaged = yield* readOptional(markerPath);

  if (input.extraSkillRoots.length === 0) {
    if (previousManaged !== undefined) {
      yield* Effect.gen(function* () {
        if (!(yield* isSymlink(profileSkillsJson))) {
          const current = yield* readOptional(profileSkillsJson);
          if (current === previousManaged) {
            yield* fs.remove(profileSkillsJson);
          }
        }
        yield* fs.remove(markerPath);
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not clean up Antigravity synced skills config.", {
            profileSkillsJson,
            error,
          }),
        ),
      );
    }
    return false;
  }

  return yield* Effect.gen(function* () {
    const linked = yield* isSymlink(profileSkillsJson);
    if (linked) {
      // Unlink before writing so we never write through a symlink into the user's ~/.gemini.
      yield* fs.remove(profileSkillsJson);
    } else {
      const current = yield* readOptional(profileSkillsJson);
      if (current !== undefined && current !== previousManaged) {
        const copiesText = yield* readOptional(ruleCopiesPath);
        const copiedSkillsJson = Option.getOrUndefined(decodeRuleCopies(copiesText ?? ""))?.[
          SKILLS_CONFIG_KEY
        ];
        if (current !== copiedSkillsJson) {
          yield* Effect.logWarning(
            "Skipping Antigravity synced skills overlay because profile config/skills.json was customized.",
            { profileSkillsJson },
          );
          return false;
        }
      }
    }

    const userConfigExists = yield* fs
      .exists(userSkillsJson)
      .pipe(Effect.orElseSucceed(() => false));
    const payload = {
      ...(userConfigExists
        ? { inherits: [{ path: formatAntigravityConfigPath(userSkillsJson, input.platform) }] }
        : {}),
      entries: input.extraSkillRoots.map((root) => ({
        path: formatAntigravityConfigPath(root, input.platform),
      })),
    };
    const contents = `${encodeSkillsConfig(payload)}\n`;
    yield* fs.makeDirectory(path.dirname(profileSkillsJson), { recursive: true });
    yield* fs.writeFileString(profileSkillsJson, contents);
    yield* fs.writeFileString(markerPath, contents);
    return true;
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not write Antigravity synced skills config.", {
        profileSkillsJson,
        error,
      }).pipe(Effect.as(false)),
    ),
  );
});
