import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as DesktopAppIdentity from "../../app/DesktopAppIdentity.ts";
import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../../app/DesktopObservability.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import {
  FORK_TRAY_FLAGS_FILE,
  FORK_TRAY_NEW_THREAD_ACTION,
  type ResolvedForkTrayFlags,
  decodeForkTrayFlags,
  encodeForkTrayFlags,
  resolveCloseToTraySetting,
  shouldHideOnClose,
} from "./DesktopTray.logic.ts";

const { logWarning } = makeComponentLogger("fork-tray");

type ForkTrayRuntimeServices =
  | DesktopState.DesktopState
  | DesktopWindow.DesktopWindow
  | ElectronApp.ElectronApp
  | ElectronWindow.ElectronWindow
  | FileSystem.FileSystem
  | Path.Path;

function hasElectronTrayApi(): boolean {
  try {
    return (
      typeof Electron.Tray === "function" && typeof Electron.Menu?.buildFromTemplate === "function"
    );
  } catch {
    return false;
  }
}

function listOpenBrowserWindows(): ReadonlyArray<Electron.BrowserWindow> {
  try {
    return typeof Electron.BrowserWindow?.getAllWindows === "function"
      ? Electron.BrowserWindow.getAllWindows()
      : [];
  } catch {
    return [];
  }
}

function createTrayIcon(
  iconPaths: DesktopAssets.DesktopIconPaths,
  platform: NodeJS.Platform,
): Electron.NativeImage | string | null {
  if (platform === "win32") {
    const icoPath = Option.getOrNull(iconPaths.ico);
    if (icoPath !== null) return icoPath;
  }
  const pngPath = Option.getOrNull(iconPaths.png);
  if (pngPath === null || typeof Electron.nativeImage?.createFromPath !== "function") {
    return null;
  }
  const image = Electron.nativeImage.createFromPath(pngPath).resize({ width: 32, height: 32 });
  return image.isEmpty() ? null : image;
}

const readFlagsFile = Effect.fn("desktop.fork.tray.readFlagsFile")(function* (flagsPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(flagsPath).pipe(Effect.option);
  return decodeForkTrayFlags(Option.getOrUndefined(raw));
});

const writeFlagsFile = Effect.fn("desktop.fork.tray.writeFlagsFile")(
  function* (flagsPath: string, flags: ResolvedForkTrayFlags) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(flagsPath), { recursive: true });
    yield* fs.writeFileString(flagsPath, encodeForkTrayFlags(flags));
  },
  Effect.catchCause((cause) => logWarning("failed to persist fork tray flags", { cause })),
);

export const install = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (environment.platform === "darwin") return;

  if (!hasElectronTrayApi()) {
    return;
  }

  const assetsOption = yield* Effect.serviceOption(DesktopAssets.DesktopAssets);
  if (Option.isNone(assetsOption)) return;

  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const path = yield* Path.Path;
  const hostEnv = yield* HostProcess.Environment;
  const userDataPath = yield* appIdentity.resolveUserDataPath.pipe(
    Effect.catchCause(() => Effect.succeed("")),
  );
  if (userDataPath.length === 0) return;

  const flagsPath = path.join(userDataPath, FORK_TRAY_FLAGS_FILE);
  const storedFlags = yield* readFlagsFile(flagsPath);
  const initialCloseToTray = resolveCloseToTraySetting(storedFlags, hostEnv.T3_FORK_CLOSE_TO_TRAY);
  if (!initialCloseToTray) return;

  const iconPaths = yield* assetsOption.value.iconPaths;
  const icon = createTrayIcon(iconPaths, environment.platform);
  if (icon === null) {
    yield* logWarning("no tray icon image is available; close to tray stays off");
    return;
  }

  const desktopState = yield* DesktopState.DesktopState;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const context = yield* Effect.context<ForkTrayRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);
  const runSync = Effect.runSyncWith(context);

  const flagsRef = yield* Ref.make<ResolvedForkTrayFlags>({
    ...storedFlags,
    closeToTray: true,
  });
  const hasTrayRef = yield* Ref.make(false);

  let tray: Electron.Tray | null = null;
  const destroyTray = Effect.sync(() => {
    const previous = tray;
    tray = null;
    if (previous !== null && !previous.isDestroyed()) {
      previous.destroy();
    }
  });

  yield* Effect.addFinalizer(() => Ref.set(hasTrayRef, false).pipe(Effect.andThen(destroyTray)));

  const activateMain = () => {
    void runPromise(
      desktopWindow.activate.pipe(
        Effect.catchCause((cause) => logWarning("failed to open window from tray", { cause })),
      ),
    );
  };

  const openNewThread = () => {
    void runPromise(
      desktopWindow.activate.pipe(
        Effect.andThen(
          desktopWindow.dispatchMenuAction(FORK_TRAY_NEW_THREAD_ACTION, { reveal: true }),
        ),
        Effect.catchCause((cause) => logWarning("failed to open new thread from tray", { cause })),
      ),
    );
  };

  const quitApp = () => {
    void runPromise(electronApp.quit);
  };

  const applyContextMenu = (closeToTray: boolean) => {
    if (tray === null || tray.isDestroyed()) return;
    tray.setContextMenu(
      Electron.Menu.buildFromTemplate([
        { label: "Open", click: activateMain },
        { label: "New thread", click: openNewThread },
        { type: "separator" },
        {
          label: "Close to tray",
          type: "checkbox",
          checked: closeToTray,
          click: (menuItem) => {
            const nextEnabled = menuItem.checked === true;
            void runPromise(
              Effect.gen(function* () {
                const updated = yield* Ref.updateAndGet(flagsRef, (current) => ({
                  ...current,
                  closeToTray: nextEnabled,
                }));
                yield* writeFlagsFile(flagsPath, updated);
                yield* Effect.sync(() => applyContextMenu(updated.closeToTray));
                if (!nextEnabled) {
                  const main = yield* electronWindow.main;
                  if (Option.isSome(main) && !main.value.isVisible()) {
                    yield* desktopWindow.activate.pipe(Effect.ignoreCause);
                  }
                }
              }),
            );
          },
        },
        { type: "separator" },
        { label: "Quit", click: quitApp },
      ]),
    );
  };

  const configured = yield* Effect.sync(() => {
    const created = new Electron.Tray(icon);
    tray = created;
    created.setToolTip(environment.displayName);
    applyContextMenu(true);
    created.on("click", activateMain);
    return true;
  }).pipe(
    Effect.catchCause((cause) =>
      Ref.set(hasTrayRef, false).pipe(
        Effect.andThen(
          destroyTray.pipe(
            Effect.catchCause((cleanupCause) =>
              logWarning("failed to destroy unfinished tray", { cause: cleanupCause }),
            ),
          ),
        ),
        Effect.andThen(logWarning("failed to install fork tray", { cause })),
        Effect.as(false),
      ),
    ),
  );
  if (!configured) return;

  yield* Ref.set(hasTrayRef, true);

  const attachedWindows = new WeakSet<Electron.BrowserWindow>();
  const cleanups: Array<() => void> = [];
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
    }),
  );

  const attachWindow = (window: Electron.BrowserWindow) => {
    if (attachedWindows.has(window)) return;
    attachedWindows.add(window);
    let sessionEnding = false;
    const onSessionEnd = () => {
      sessionEnding = true;
    };
    const onClose = (event: Electron.Event) => {
      const decision = runSync(
        Effect.gen(function* () {
          const [quitting, flags, hasTray, mainWindow] = yield* Effect.all([
            Ref.get(desktopState.quitting),
            Ref.get(flagsRef),
            Ref.get(hasTrayRef),
            electronWindow.main,
          ]);
          return shouldHideOnClose({
            quitting,
            sessionEnding,
            closeToTray: flags.closeToTray,
            hasTray,
            isMainWindow: Option.isSome(mainWindow) && mainWindow.value === window,
            platform: environment.platform,
          });
        }),
      );
      if (!decision) return;
      event.preventDefault();
      window.hide();
    };
    window.on("session-end", onSessionEnd);
    window.on("close", onClose);
    cleanups.push(() => {
      if (window.isDestroyed()) return;
      window.removeListener("session-end", onSessionEnd);
      window.removeListener("close", onClose);
    });
  };

  yield* Effect.sync(() => {
    for (const window of listOpenBrowserWindows()) {
      attachWindow(window);
    }
  });

  yield* electronApp.on(
    "browser-window-created",
    (_event: unknown, window: Electron.BrowserWindow) => {
      attachWindow(window);
    },
  );
}).pipe(Effect.withSpan("desktop.fork.tray.install"));
