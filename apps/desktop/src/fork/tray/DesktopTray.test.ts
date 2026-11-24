import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import type * as Electron from "electron";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import { beforeEach, vi } from "vite-plus/test";

interface FakeMenuItem {
  readonly label?: string;
  readonly type?: string;
  readonly checked?: boolean;
  readonly click?: (menuItem: { checked?: boolean }) => void;
}

interface FakeTray {
  readonly image: unknown;
  readonly listeners: Map<string, Array<(...args: Array<unknown>) => void>>;
  setToolTip: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
}

const electronMock = vi.hoisted(() => {
  const trays: FakeTray[] = [];
  let menuTemplates: Array<ReadonlyArray<FakeMenuItem>> = [];
  const resizedImage = { isEmpty: vi.fn(() => false) };
  const resize = vi.fn(
    (_options: { readonly width: number; readonly height: number }) => resizedImage,
  );
  const createFromPath = vi.fn((_path: string) => ({ resize, isEmpty: vi.fn(() => false) }));
  const createTray = function (this: FakeTray, image: unknown) {
    let destroyed = false;
    const listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
    (this as { image: unknown }).image = image;
    (this as { listeners: Map<string, Array<(...args: Array<unknown>) => void>> }).listeners =
      listeners;
    this.setToolTip = vi.fn();
    this.setContextMenu = vi.fn();
    this.on = vi.fn((event: string, listener: (...args: Array<unknown>) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return this;
    });
    this.destroy = vi.fn(() => {
      destroyed = true;
    });
    this.isDestroyed = vi.fn(() => destroyed);
    trays.push(this);
  };
  const Tray = vi.fn(createTray);
  const buildFromTemplate = vi.fn((template: ReadonlyArray<FakeMenuItem>) => {
    menuTemplates.push(template);
    return { template };
  });
  const getAllWindows = vi.fn(() => [] as Array<Electron.BrowserWindow>);
  return {
    trays,
    getMenuTemplates: () => menuTemplates,
    resetMenuTemplates: () => {
      menuTemplates = [];
    },
    resizedImage,
    resize,
    createFromPath,
    createTray,
    Tray,
    buildFromTemplate,
    getAllWindows,
  };
});

vi.mock("electron", () => ({
  Tray: electronMock.Tray,
  Menu: { buildFromTemplate: electronMock.buildFromTemplate },
  nativeImage: { createFromPath: electronMock.createFromPath },
  BrowserWindow: { getAllWindows: electronMock.getAllWindows },
}));

import * as DesktopAppIdentity from "../../app/DesktopAppIdentity.ts";
import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { FORK_TRAY_FLAGS_FILE, decodeForkTrayFlags } from "./DesktopTray.logic.ts";
import * as DesktopTray from "./DesktopTray.ts";

interface FakeBrowserWindow {
  readonly window: Electron.BrowserWindow;
  readonly hide: ReturnType<typeof vi.fn>;
  readonly emit: (event: string, ...args: Array<unknown>) => void;
  setVisible: (visible: boolean) => void;
}

function makeFakeWindow(initialVisible = true): FakeBrowserWindow {
  let visible = initialVisible;
  const listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
  const hide = vi.fn(() => {
    visible = false;
  });
  const window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    hide,
    on: (event: string, listener: (...args: Array<unknown>) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return window;
    },
    removeListener: (event: string, listener: (...args: Array<unknown>) => void) => {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((entry) => entry !== listener),
      );
      return window;
    },
  } as unknown as Electron.BrowserWindow;
  return {
    window,
    hide,
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
    setVisible: (next) => {
      visible = next;
    },
  };
}

interface HarnessOptions {
  readonly platform?: NodeJS.Platform;
  readonly ico?: string;
  readonly png?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly initialFlagsJson?: string;
}

const makeHarness = (options: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-tray-" });
    const flagsPath = path.join(userDataDir, FORK_TRAY_FLAGS_FILE);
    if (options.initialFlagsJson !== undefined) {
      yield* fs.writeFileString(flagsPath, options.initialFlagsJson);
    }

    const quitting = yield* Ref.make(false);
    const mainWindowRef = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
    const appListeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
    const activateCalls = yield* Ref.make(0);
    const activateWaiter = yield* Ref.make<Option.Option<Deferred.Deferred<void>>>(Option.none());
    const menuActions = yield* Ref.make<Array<{ action: string; reveal?: boolean }>>([]);
    const quitCalls = yield* Ref.make(0);

    const layer = Layer.mergeAll(
      Layer.succeed(DesktopAppIdentity.DesktopAppIdentity, {
        resolveUserDataPath: Effect.succeed(userDataDir),
        configure: Effect.void,
      } as DesktopAppIdentity.DesktopAppIdentity["Service"]),
      Layer.succeed(DesktopAssets.DesktopAssets, {
        iconPaths: Effect.succeed({
          ico: Option.fromNullishOr(options.ico),
          icns: Option.none(),
          png: Option.fromNullishOr(options.png),
        }),
        resolveResourcePath: () => Effect.succeedNone,
      }),
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        platform: options.platform ?? "win32",
        displayName: "T3 Code (Beta)",
      } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
      Layer.succeed(DesktopState.DesktopState, {
        quitting,
      } as DesktopState.DesktopState["Service"]),
      Layer.succeed(DesktopWindow.DesktopWindow, {
        activate: Ref.update(activateCalls, (count) => count + 1).pipe(
          Effect.andThen(
            Ref.getAndSet(activateWaiter, Option.none()).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.void,
                  onSome: (deferred) => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid),
                }),
              ),
            ),
          ),
        ),
        dispatchMenuAction: (action: string, actionOptions?: { readonly reveal?: boolean }) =>
          Ref.update(menuActions, (items) => [
            ...items,
            {
              action,
              ...(actionOptions?.reveal === undefined ? {} : { reveal: actionOptions.reveal }),
            },
          ]),
      } as unknown as DesktopWindow.DesktopWindow["Service"]),
      Layer.succeed(ElectronApp.ElectronApp, {
        quit: Ref.update(quitCalls, (count) => count + 1),
        on: (eventName: string, listener: (...args: Array<unknown>) => void) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const list = appListeners.get(eventName) ?? [];
              list.push(listener);
              appListeners.set(eventName, list);
            }),
            () =>
              Effect.sync(() => {
                const list = appListeners.get(eventName) ?? [];
                appListeners.set(
                  eventName,
                  list.filter((entry) => entry !== listener),
                );
              }),
          ).pipe(Effect.asVoid),
      } as unknown as ElectronApp.ElectronApp["Service"]),
      Layer.succeed(ElectronWindow.ElectronWindow, {
        main: Ref.get(mainWindowRef),
      } as unknown as ElectronWindow.ElectronWindow["Service"]),
      Layer.succeed(HostProcess.Environment, options.env ?? {}),
      Layer.succeed(FileSystem.FileSystem, fs),
      Layer.succeed(Path.Path, path),
    );

    const emitApp = (eventName: string, ...args: Array<unknown>) => {
      for (const listener of appListeners.get(eventName) ?? []) {
        listener(...args);
      }
    };

    return {
      layer,
      flagsPath,
      quitting,
      mainWindowRef,
      activateCalls,
      activateWaiter,
      menuActions,
      quitCalls,
      emitApp,
    };
  });

beforeEach(() => {
  electronMock.trays.length = 0;
  electronMock.resetMenuTemplates();
  electronMock.Tray.mockReset().mockImplementation(electronMock.createTray);
  electronMock.buildFromTemplate.mockClear();
  electronMock.createFromPath.mockClear();
  electronMock.resize.mockClear();
  electronMock.resizedImage.isEmpty.mockReset().mockReturnValue(false);
  electronMock.getAllWindows.mockReset().mockReturnValue([]);
});

describe("DesktopTray", () => {
  it.effect(
    "hides the main window on close, leaves auxiliary windows alone, and allows quit or session-end",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ platform: "win32", ico: "C:\\icons\\t3.ico" });
        const installScope = yield* Scope.make();
        yield* DesktopTray.install.pipe(
          Effect.provide(harness.layer),
          Effect.provideService(Scope.Scope, installScope),
        );

        assert.equal(electronMock.trays.length, 1);
        assert.equal(electronMock.trays[0]!.setToolTip.mock.calls[0]?.[0], "T3 Code (Beta)");

        const main = makeFakeWindow(true);
        const popup = makeFakeWindow(true);
        yield* Ref.set(harness.mainWindowRef, Option.some(main.window));
        harness.emitApp("browser-window-created", {}, main.window);
        harness.emitApp("browser-window-created", {}, popup.window);

        const mainClose = { preventDefault: vi.fn() };
        main.emit("close", mainClose);
        assert.equal(mainClose.preventDefault.mock.calls.length, 1);
        assert.equal(main.hide.mock.calls.length, 1);

        const popupClose = { preventDefault: vi.fn() };
        popup.emit("close", popupClose);
        assert.equal(popupClose.preventDefault.mock.calls.length, 0);
        assert.equal(popup.hide.mock.calls.length, 0);

        // Final Windows logoff must bypass close-to-tray.
        main.emit("session-end");
        const logoffClose = { preventDefault: vi.fn() };
        main.emit("close", logoffClose);
        assert.equal(logoffClose.preventDefault.mock.calls.length, 0);

        // Fresh main window during explicit quit also closes normally.
        const secondMain = makeFakeWindow(true);
        yield* Ref.set(harness.mainWindowRef, Option.some(secondMain.window));
        harness.emitApp("browser-window-created", {}, secondMain.window);
        yield* Ref.set(harness.quitting, true);
        const quitClose = { preventDefault: vi.fn() };
        secondMain.emit("close", quitClose);
        assert.equal(quitClose.preventDefault.mock.calls.length, 0);

        yield* Scope.close(installScope, Exit.void);
        assert.equal(electronMock.trays[0]!.destroy.mock.calls.length, 1);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "wires tray click and menu items for Open, New thread, Close to tray toggle, and Quit",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const harness = yield* makeHarness({ platform: "win32", ico: "C:\\icons\\t3.ico" });
        yield* DesktopTray.install.pipe(Effect.provide(harness.layer));

        const tray = electronMock.trays[0]!;
        const template = electronMock.getMenuTemplates().at(-1)!;
        const openItem = template.find((item) => item.label === "Open");
        const newThreadItem = template.find((item) => item.label === "New thread");
        const toggleItem = template.find((item) => item.label === "Close to tray");
        const quitItem = template.find((item) => item.label === "Quit");

        assert.isDefined(openItem);
        assert.isDefined(newThreadItem);
        assert.isDefined(toggleItem);
        assert.isDefined(quitItem);
        assert.equal(toggleItem?.type, "checkbox");
        assert.isTrue(toggleItem?.checked);

        // Left-click and Open both activate the main window.
        for (const listener of tray.listeners.get("click") ?? []) listener();
        openItem!.click!({});
        yield* Effect.yieldNow;
        assert.equal(yield* Ref.get(harness.activateCalls), 2);

        // New thread activates and dispatches the fork menu action.
        newThreadItem!.click!({});
        yield* Effect.yieldNow;
        assert.equal(yield* Ref.get(harness.activateCalls), 3);
        assert.deepEqual(yield* Ref.get(harness.menuActions), [
          { action: "fork.newThread", reveal: true },
        ]);

        // Turning Close to tray off persists the setting, reveals a hidden window, and stops hiding on close.
        const main = makeFakeWindow(false);
        yield* Ref.set(harness.mainWindowRef, Option.some(main.window));
        harness.emitApp("browser-window-created", {}, main.window);
        const revealed = yield* Deferred.make<void>();
        yield* Ref.set(harness.activateWaiter, Option.some(revealed));
        toggleItem!.click!({ checked: false });
        yield* Deferred.await(revealed);
        const stored = decodeForkTrayFlags(yield* fs.readFileString(harness.flagsPath));
        assert.isFalse(stored.closeToTray);
        assert.equal(yield* Ref.get(harness.activateCalls), 4);

        const closeAfterDisable = { preventDefault: vi.fn() };
        main.emit("close", closeAfterDisable);
        assert.equal(closeAfterDisable.preventDefault.mock.calls.length, 0);

        // Quit runs the normal full quit path.
        quitItem!.click!({});
        yield* Effect.yieldNow;
        assert.equal(yield* Ref.get(harness.quitCalls), 1);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    {
      name: "darwin skips tray",
      options: { platform: "darwin" as const, ico: "C:\\icons\\t3.ico" },
    },
    {
      name: "closeToTray false in fork-tray.json skips tray",
      options: {
        platform: "win32" as const,
        ico: "C:\\icons\\t3.ico",
        initialFlagsJson: '{"closeToTray":false}',
      },
    },
    {
      name: "T3_FORK_CLOSE_TO_TRAY=0 skips tray",
      options: {
        platform: "win32" as const,
        ico: "C:\\icons\\t3.ico",
        env: { T3_FORK_CLOSE_TO_TRAY: "0" },
      },
    },
    {
      name: "missing icon skips tray",
      options: { platform: "win32" as const },
    },
  ])("$name", ({ options }) =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(options);
      yield* DesktopTray.install.pipe(Effect.provide(harness.layer));

      assert.equal(electronMock.trays.length, 0);
      const main = makeFakeWindow(true);
      yield* Ref.set(harness.mainWindowRef, Option.some(main.window));
      harness.emitApp("browser-window-created", {}, main.window);
      const closeEvent = { preventDefault: vi.fn() };
      main.emit("close", closeEvent);
      assert.equal(closeEvent.preventDefault.mock.calls.length, 0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "destroys a half-configured tray and leaves close-to-tray off when menu setup fails",
    () =>
      Effect.gen(function* () {
        electronMock.buildFromTemplate.mockImplementationOnce(() => {
          throw new Error("menu build failed");
        });
        const harness = yield* makeHarness({ platform: "win32", ico: "C:\\icons\\t3.ico" });
        yield* DesktopTray.install.pipe(Effect.provide(harness.layer));

        assert.equal(electronMock.trays.length, 1);
        assert.equal(electronMock.trays[0]!.destroy.mock.calls.length, 1);

        const main = makeFakeWindow(true);
        yield* Ref.set(harness.mainWindowRef, Option.some(main.window));
        harness.emitApp("browser-window-created", {}, main.window);
        const closeEvent = { preventDefault: vi.fn() };
        main.emit("close", closeEvent);
        assert.equal(closeEvent.preventDefault.mock.calls.length, 0);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uses a resized png icon on Linux", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ platform: "linux", png: "/usr/share/icons/t3.png" });
      yield* DesktopTray.install.pipe(Effect.provide(harness.layer));

      assert.equal(electronMock.trays.length, 1);
      assert.equal(electronMock.createFromPath.mock.calls[0]?.[0], "/usr/share/icons/t3.png");
      assert.deepEqual(electronMock.resize.mock.calls[0]?.[0], { width: 32, height: 32 });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
