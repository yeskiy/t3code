import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as AntigravityInstallation from "../../provider/AntigravityInstallation.ts";
import { AntigravityDriver } from "../../provider/Drivers/AntigravityDriver.ts";
import * as ModelManifest from "../../provider/ModelManifest.ts";
import * as ProviderHostLive from "../../provider/ProviderHostLive.ts";
import * as ServerSettings from "../../serverSettings.ts";

const ORG_ID = "11111111-2222-4333-8444-555555555555";
const ACCOUNT_ID = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const BUCKET = `${ORG_ID}_${ACCOUNT_ID}`;

it.effect(
  "AntigravityDriver exposes and refreshes shared Claude synced skills in snapshotForCwd",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-driver-synced-" });
      const claudeHome = path.join(tempDir, "claude-home");
      const workspace = path.join(tempDir, "workspace");
      const fakeUserHome = path.join(tempDir, "user-home");
      const syncedDir = path.join(claudeHome, "skills", "synced");
      const bucketDir = path.join(syncedDir, BUCKET);

      yield* fs.makeDirectory(workspace, { recursive: true });
      yield* fs.makeDirectory(fakeUserHome, { recursive: true });
      yield* fs.makeDirectory(path.join(bucketDir, "docx"), { recursive: true });
      yield* fs.writeFileString(
        path.join(bucketDir, "docx", "SKILL.md"),
        "---\nname: docx\ndescription: Synced Word docs.\n---\n",
      );
      yield* fs.writeFileString(path.join(syncedDir, `.bucket-${BUCKET}`), "");
      yield* fs.writeFileString(
        path.join(claudeHome, ".claude.json"),
        JSON.stringify({ oauthAccount: { organizationUuid: ORG_ID, accountUuid: ACCOUNT_ID } }),
      );

      const serverSettingsLayer = ServerSettings.layerTest({
        providerInstances: {
          [ProviderInstanceId.make("claude-shared")]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            config: { homePath: claudeHome },
          },
        },
      });
      const deps = ServerConfig.layerTest(tempDir, {
        prefix: "t3-ag-driver-synced-cfg-",
      }).pipe(
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        Layer.provideMerge(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("Unexpected HTTP request")),
          ),
        ),
        Layer.provideMerge(serverSettingsLayer),
        Layer.provideMerge(
          Layer.mock(BackgroundPolicy.BackgroundPolicy)({
            shouldRunScopeWork: () => Effect.succeed(false),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
        Layer.provideMerge(ModelManifest.layerTest),
        Layer.provideMerge(IdAllocator.layer),
        Layer.provideMerge(McpProviderSessions.layer),
      );
      const hostLayer = ProviderHostLive.layer.pipe(
        Layer.provideMerge(ServerSecretStore.layer),
        Layer.provideMerge(deps),
      );
      const installLayer = Layer.mock(AntigravityInstallation.AntigravityInstallation)({
        managedDirectory: tempDir,
        resolve: () => Effect.die("unused"),
        acquire: () => Effect.die("unused"),
        compatibility: () => Effect.undefined,
      });

      yield* Effect.gen(function* () {
        const enabledInstance = yield* AntigravityDriver.create({
          instanceId: ProviderInstanceId.make("ag-shared"),
          displayName: "AG Shared",
          enabled: true,
          config: {
            ...AntigravityDriver.defaultConfig(),
            claudeSyncedSkillsInstance: "claude-shared",
          },
          environment: [
            { name: "HOME", value: fakeUserHome, sensitive: false },
            { name: "USERPROFILE", value: fakeUserHome, sensitive: false },
          ],
        });

        const firstSnapshot = yield* enabledInstance.snapshotForCwd!(workspace);
        expect(firstSnapshot.skills?.map((skill) => skill.name)).toEqual(["docx"]);

        // A re-sync adds another skill to the bucket; the next scan picks it up immediately.
        yield* fs.makeDirectory(path.join(bucketDir, "pdf"), { recursive: true });
        yield* fs.writeFileString(
          path.join(bucketDir, "pdf", "SKILL.md"),
          "---\nname: pdf\ndescription: Synced PDFs.\n---\n",
        );
        const refreshedSnapshot = yield* enabledInstance.snapshotForCwd!(workspace);
        expect(refreshedSnapshot.skills?.map((skill) => skill.name)).toEqual(["docx", "pdf"]);

        // Empty claudeSyncedSkillsInstance turns sharing off.
        const disabledInstance = yield* AntigravityDriver.create({
          instanceId: ProviderInstanceId.make("ag-disabled"),
          displayName: "AG Disabled",
          enabled: true,
          config: {
            ...AntigravityDriver.defaultConfig(),
            claudeSyncedSkillsInstance: "",
          },
          environment: [
            { name: "HOME", value: fakeUserHome, sensitive: false },
            { name: "USERPROFILE", value: fakeUserHome, sensitive: false },
          ],
        });
        const disabledSnapshot = yield* disabledInstance.snapshotForCwd!(workspace);
        expect(disabledSnapshot.skills).toEqual([]);
      }).pipe(Effect.provide(Layer.mergeAll(hostLayer, installLayer)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
