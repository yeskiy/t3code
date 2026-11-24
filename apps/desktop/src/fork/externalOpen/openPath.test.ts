import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { beforeEach, vi } from "vite-plus/test";

const { openPathMock } = vi.hoisted(() => ({
  openPathMock: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: {
    openPath: openPathMock,
  },
}));

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { forkOpenPath, ForkOpenPathResultSchema } from "./openPath.ts";

const decodeResult = Schema.decodeUnknownSync(ForkOpenPathResultSchema);

describe("forkOpenPath", () => {
  beforeEach(() => {
    openPathMock.mockReset();
    openPathMock.mockResolvedValue("");
  });

  it.effect("opens existing local host files via shell.openPath after load-checking", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const currentPlatform = yield* HostProcess.Platform;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const htmlPath = path.join(stateDir, "report with spaces.html");
      const missingPath = path.join(stateDir, "missing.pdf");
      const batPath = path.join(stateDir, "run.bat");
      yield* fs.writeFileString(htmlPath, "<h1>Report</h1>");
      yield* fs.writeFileString(batPath, "echo hi");
      yield* fs.writeFileString(path.join(stateDir, "environment-id"), "host-env\n");

      const run = (
        environmentId: string,
        target: string,
        platform: NodeJS.Platform = currentPlatform,
        senderId = 1,
      ) =>
        forkOpenPath.handler({ environmentId, path: target }, { sender: { id: senderId } }).pipe(
          Effect.map(decodeResult),
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, {
            path,
            stateDir,
            platform,
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
          Effect.provideService(ElectronWindow.ElectronWindow, {
            main: Effect.succeedSome({ webContents: { id: 1 } }),
          } as unknown as ElectronWindow.ElectronWindow["Service"]),
        );

      const remoteResult = yield* run("remote-env", htmlPath);
      assert.deepEqual(remoteResult, { ok: false, reason: "not-host-environment" });

      const wrongSender = yield* run("host-env", htmlPath, currentPlatform, 99);
      assert.equal(wrongSender.ok, false);
      assert.equal(wrongSender.reason, "unauthorized-sender");

      const relativeResult = yield* run("host-env", "relative.html");
      assert.equal(relativeResult.ok, false);
      assert.equal(relativeResult.reason, "invalid-path");

      const fileUrlResult = yield* run("host-env", "file:///C:/Windows/win.ini");
      assert.equal(fileUrlResult.ok, false);
      assert.equal(fileUrlResult.reason, "invalid-path");

      const missingResult = yield* run("host-env", missingPath);
      assert.equal(missingResult.ok, false);
      assert.equal(missingResult.reason, "not-found");

      if (currentPlatform === "win32") {
        const blockedResult = yield* run("host-env", batPath, "win32");
        assert.equal(blockedResult.ok, false);
        assert.equal(blockedResult.reason, "blocked-executable");
      }

      assert.equal(openPathMock.mock.calls.length, 0);

      const okResult = yield* run("host-env", htmlPath);
      assert.deepEqual(okResult, { ok: true });
      assert.equal(openPathMock.mock.calls.length, 1);

      openPathMock.mockResolvedValueOnce("No application is associated with the specified file");
      const osErrorResult = yield* run("host-env", htmlPath);
      assert.equal(osErrorResult.ok, false);
      assert.equal(osErrorResult.reason, "open-failed");
      assert.equal(osErrorResult.error, "No application is associated with the specified file");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
