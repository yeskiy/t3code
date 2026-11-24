import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../../ipc/channels.ts";
import { makeIpcMethod } from "../../ipc/DesktopIpc.ts";
import { getHostEnvironmentId } from "../../ipc/methods/localEnvironment.ts";
import { validateLocalOpenPath } from "./openPath.logic.ts";

const ForkOpenPathReasonSchema = Schema.Literals([
  "unauthorized-sender",
  "not-host-environment",
  "invalid-path",
  "blocked-executable",
  "not-found",
  "open-failed",
]);

export const ForkOpenPathResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optionalKey(ForkOpenPathReasonSchema),
  error: Schema.optionalKey(Schema.String),
});

export type ForkOpenPathResult = typeof ForkOpenPathResultSchema.Type;

export const forkOpenPath = makeIpcMethod({
  channel: IpcChannels.FORK_OPEN_PATH_CHANNEL,
  payload: Schema.Struct({ environmentId: Schema.String, path: Schema.String }),
  result: ForkOpenPathResultSchema,
  handler: Effect.fn("desktop.ipc.fork.openPath")(function* (input, event): Effect.fn.Return<
    ForkOpenPathResult,
    never,
    DesktopEnvironment.DesktopEnvironment | ElectronWindow.ElectronWindow | FileSystem.FileSystem
  > {
    const window = yield* (yield* ElectronWindow.ElectronWindow).main;
    if (Option.isNone(window) || event?.sender.id !== window.value.webContents.id) {
      return {
        ok: false,
        reason: "unauthorized-sender" as const,
        error: "Only the main app window can open local files.",
      };
    }

    const hostEnvironmentId = yield* getHostEnvironmentId
      .handler(undefined)
      .pipe(Effect.orElseSucceed(() => null));
    if (hostEnvironmentId === null || input.environmentId !== hostEnvironmentId) {
      return { ok: false, reason: "not-host-environment" as const };
    }

    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const checked = validateLocalOpenPath(input.path, environment.platform);
    if (!checked.ok) {
      return checked;
    }

    const normalizedPath = environment.path.normalize(checked.path);
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(normalizedPath).pipe(Effect.option);
    if (Option.isNone(stat) || (stat.value.type !== "File" && stat.value.type !== "Directory")) {
      return {
        ok: false,
        reason: "not-found" as const,
        error: "The file could not be found on this computer.",
      };
    }

    // Re-check the resolved target so a symlink cannot escape to a UNC share or executable.
    const realPath = yield* fs
      .realPath(normalizedPath)
      .pipe(Effect.orElseSucceed(() => normalizedPath));
    const realChecked = validateLocalOpenPath(realPath, environment.platform);
    if (!realChecked.ok) {
      return realChecked;
    }

    const osError = yield* Effect.promise(() =>
      Electron.shell.openPath(realChecked.path).catch((cause: unknown) => String(cause)),
    );
    if (osError.length > 0) {
      return { ok: false, reason: "open-failed" as const, error: osError };
    }
    return { ok: true };
  }),
});
