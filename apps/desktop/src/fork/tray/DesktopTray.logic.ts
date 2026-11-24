import * as Schema from "effect/Schema";

export const FORK_TRAY_FLAGS_FILE = "fork-tray.json";
export const FORK_TRAY_NEW_THREAD_ACTION = "fork.newThread";

export const ForkTrayFlags = Schema.Struct({
  closeToTray: Schema.optionalKey(Schema.Boolean),
  openAtLogin: Schema.optionalKey(Schema.Boolean),
  startHidden: Schema.optionalKey(Schema.Boolean),
});

export interface ResolvedForkTrayFlags {
  readonly closeToTray: boolean;
  readonly openAtLogin: boolean;
  readonly startHidden: boolean;
}

export const DEFAULT_FORK_TRAY_FLAGS: ResolvedForkTrayFlags = {
  closeToTray: true,
  openAtLogin: false,
  startHidden: true,
};

const decodeFlags = Schema.decodeUnknownOption(Schema.fromJsonString(ForkTrayFlags));

export const decodeForkTrayFlags = (text: string | undefined): ResolvedForkTrayFlags => {
  const decoded = text === undefined ? undefined : decodeFlags(text);
  return {
    ...DEFAULT_FORK_TRAY_FLAGS,
    ...(decoded?._tag === "Some" ? decoded.value : {}),
  };
};

export const encodeForkTrayFlags = (flags: ResolvedForkTrayFlags): string =>
  `${JSON.stringify(flags, null, 2)}\n`;

export const resolveCloseToTraySetting = (
  flags: ResolvedForkTrayFlags,
  envValue: string | undefined,
): boolean => {
  const trimmed = envValue?.trim();
  if (trimmed === "0") return false;
  if (trimmed === "1") return true;
  return flags.closeToTray;
};

// macOS keeps its own Dock behavior, so the tray handles Windows and Linux only.
export const shouldHideOnClose = (input: {
  readonly quitting: boolean;
  readonly sessionEnding: boolean;
  readonly closeToTray: boolean;
  readonly hasTray: boolean;
  readonly isMainWindow: boolean;
  readonly platform: NodeJS.Platform;
}): boolean =>
  input.platform !== "darwin" &&
  input.isMainWindow &&
  input.closeToTray &&
  input.hasTray &&
  !input.quitting &&
  !input.sessionEnding;
