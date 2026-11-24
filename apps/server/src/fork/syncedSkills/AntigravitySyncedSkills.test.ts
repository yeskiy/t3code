import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { prepareAntigravitySyncedSkillsConfig } from "./AntigravitySyncedSkills.ts";

it.layer(NodeServices.layer)("AntigravitySyncedSkills", (it) => {
  it.effect("does nothing when no extra skill roots are configured and no marker exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-synced-" });
      const profileDirectory = path.join(tempDir, "profile");
      const userHome = path.join(tempDir, "home");

      const managed = yield* prepareAntigravitySyncedSkillsConfig({
        profileDirectory,
        userHome,
        platform: "win32",
        extraSkillRoots: [],
      });
      assert.strictEqual(managed, false);
      assert.strictEqual(
        yield* fs.exists(path.join(profileDirectory, "config", "skills.json")),
        false,
      );
    }),
  );

  it.effect("writes entries only when user skills.json is absent, and inherits when present", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-synced-" });
      const profileDirectory = path.join(tempDir, "profile");
      const userHome = path.join(tempDir, "home");
      const bucketDir = path.join(tempDir, "claude", "skills", "synced", "bucket-a");
      const profileSkillsJson = path.join(profileDirectory, "config", "skills.json");
      const userSkillsJson = path.join(userHome, ".gemini", "config", "skills.json");

      const firstManaged = yield* prepareAntigravitySyncedSkillsConfig({
        profileDirectory,
        userHome,
        platform: "win32",
        extraSkillRoots: [bucketDir],
      });
      assert.strictEqual(firstManaged, true);
      assert.deepEqual(JSON.parse(yield* fs.readFileString(profileSkillsJson)), {
        entries: [{ path: bucketDir.replaceAll("\\", "/") }],
      });

      // Adding user skills.json updates the profile overlay with inherits without modifying user file.
      const userContents = JSON.stringify({ entries: [{ path: "C:/user/skills" }] });
      yield* fs.makeDirectory(path.dirname(userSkillsJson), { recursive: true });
      yield* fs.writeFileString(userSkillsJson, userContents);

      const secondManaged = yield* prepareAntigravitySyncedSkillsConfig({
        profileDirectory,
        userHome,
        platform: "win32",
        extraSkillRoots: [bucketDir],
      });
      assert.strictEqual(secondManaged, true);
      assert.deepEqual(JSON.parse(yield* fs.readFileString(profileSkillsJson)), {
        inherits: [{ path: userSkillsJson.replaceAll("\\", "/") }],
        entries: [{ path: bucketDir.replaceAll("\\", "/") }],
      });
      assert.strictEqual(yield* fs.readFileString(userSkillsJson), userContents);

      // Recomputing with a different bucket updates the entry.
      const bucketDirB = path.join(tempDir, "claude", "skills", "synced", "bucket-b");
      assert.strictEqual(
        yield* prepareAntigravitySyncedSkillsConfig({
          profileDirectory,
          userHome,
          platform: "win32",
          extraSkillRoots: [bucketDirB],
        }),
        true,
      );
      assert.deepEqual(JSON.parse(yield* fs.readFileString(profileSkillsJson)), {
        inherits: [{ path: userSkillsJson.replaceAll("\\", "/") }],
        entries: [{ path: bucketDirB.replaceAll("\\", "/") }],
      });

      // Disabling removes the managed file and returns false so upstream can restore its link/copy.
      assert.strictEqual(
        yield* prepareAntigravitySyncedSkillsConfig({
          profileDirectory,
          userHome,
          platform: "win32",
          extraSkillRoots: [],
        }),
        false,
      );
      assert.strictEqual(yield* fs.exists(profileSkillsJson), false);
      assert.strictEqual(yield* fs.readFileString(userSkillsJson), userContents);
    }),
  );

  it.effect.skipIf(!symlinksSupported)(
    "unlinks an existing profile symlink before writing so the user's skills.json is never mutated",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-synced-link-" });
        const profileDirectory = path.join(tempDir, "profile");
        const userHome = path.join(tempDir, "home");
        const bucketDir = path.join(tempDir, "bucket");
        const userSkillsJson = path.join(userHome, ".gemini", "config", "skills.json");
        const profileSkillsJson = path.join(profileDirectory, "config", "skills.json");
        const userContents = '{"entries":[{"path":"/user/skills"}]}';

        yield* fs.makeDirectory(path.dirname(userSkillsJson), { recursive: true });
        yield* fs.makeDirectory(path.dirname(profileSkillsJson), { recursive: true });
        yield* fs.writeFileString(userSkillsJson, userContents);
        yield* fs.symlink(userSkillsJson, profileSkillsJson);

        const managed = yield* prepareAntigravitySyncedSkillsConfig({
          profileDirectory,
          userHome,
          platform: "linux",
          extraSkillRoots: [bucketDir],
        });
        assert.strictEqual(managed, true);
        assert.strictEqual(yield* fs.readFileString(userSkillsJson), userContents);
        assert.deepEqual(JSON.parse(yield* fs.readFileString(profileSkillsJson)), {
          inherits: [{ path: userSkillsJson }],
          entries: [{ path: bucketDir }],
        });
      }),
  );

  it.effect("replaces an upstream Windows copy recorded in .t3-rule-copies.json", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-synced-copy-" });
      const profileDirectory = path.join(tempDir, "profile");
      const userHome = path.join(tempDir, "home");
      const bucketDir = path.join(tempDir, "bucket");
      const profileSkillsJson = path.join(profileDirectory, "config", "skills.json");
      const userSkillsJson = path.join(userHome, ".gemini", "config", "skills.json");
      const copied = '{"entries":[{"path":"C:/copied"}]}';

      yield* fs.makeDirectory(path.dirname(profileSkillsJson), { recursive: true });
      yield* fs.makeDirectory(path.dirname(userSkillsJson), { recursive: true });
      yield* fs.writeFileString(userSkillsJson, copied);
      yield* fs.writeFileString(profileSkillsJson, copied);
      yield* fs.writeFileString(
        path.join(profileDirectory, ".t3-rule-copies.json"),
        JSON.stringify({ "config/skills.json": copied }),
      );

      const managed = yield* prepareAntigravitySyncedSkillsConfig({
        profileDirectory,
        userHome,
        platform: "win32",
        extraSkillRoots: [bucketDir],
      });
      assert.strictEqual(managed, true);
      assert.deepEqual(JSON.parse(yield* fs.readFileString(profileSkillsJson)), {
        inherits: [{ path: userSkillsJson.replaceAll("\\", "/") }],
        entries: [{ path: bucketDir.replaceAll("\\", "/") }],
      });
    }),
  );

  it.effect("preserves a hand-edited profile skills.json that was not created by T3", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-synced-custom-" });
      const profileDirectory = path.join(tempDir, "profile");
      const userHome = path.join(tempDir, "home");
      const bucketDir = path.join(tempDir, "bucket");
      const profileSkillsJson = path.join(profileDirectory, "config", "skills.json");
      const custom = '{"entries":[{"path":"C:/hand-edited"}]}';

      yield* fs.makeDirectory(path.dirname(profileSkillsJson), { recursive: true });
      yield* fs.writeFileString(profileSkillsJson, custom);

      const managed = yield* prepareAntigravitySyncedSkillsConfig({
        profileDirectory,
        userHome,
        platform: "win32",
        extraSkillRoots: [bucketDir],
      });
      assert.strictEqual(managed, false);
      assert.strictEqual(yield* fs.readFileString(profileSkillsJson), custom);
    }),
  );
});
