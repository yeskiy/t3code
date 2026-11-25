import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

type DriverReader = (environmentId: EnvironmentId, instanceId: ProviderInstanceId) => string | null;

export interface ForkTranscriptShortcutContext {
  readonly forkTranscriptPending: boolean;
  readonly forkTranscriptSelectMode: boolean;
}

const IDLE: ForkTranscriptShortcutContext = {
  forkTranscriptPending: false,
  forkTranscriptSelectMode: false,
};

// The edit session registers the readers, so this module stays light for keybindings.ts.
const store: {
  read: (() => ForkTranscriptShortcutContext) | null;
  selectModeOf: ((threadKey: string) => boolean) | null;
  driverOf: DriverReader | null;
} = { read: null, selectModeOf: null, driverOf: null };

export const setForkTranscriptShortcutReader = (
  read: (() => ForkTranscriptShortcutContext) | null,
) => {
  store.read = read;
};

export const setForkTranscriptSelectModeReader = (read: (threadKey: string) => boolean) => {
  store.selectModeOf = read;
};

export const readForkTranscriptSelectMode = (threadKey: string): boolean =>
  store.selectModeOf?.(threadKey) ?? false;

export const setForkTranscriptDriverReader = (read: DriverReader) => {
  store.driverOf = read;
};

// A null driver is unknown, for example before the server config loads.
export const readForkTranscriptDriver: DriverReader = (environmentId, instanceId) =>
  store.driverOf?.(environmentId, instanceId) ?? null;

export const readForkTranscriptShortcutContext = (): ForkTranscriptShortcutContext =>
  store.read?.() ?? IDLE;
