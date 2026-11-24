/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { EnvironmentId } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { readLocalStorageValue, useLocalStorage } from "~/hooks/useLocalStorage";
import { readLocalApi } from "~/localApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { hostEnvironmentIdAtom } from "~/state/primaryEnvironment";
import {
  FORK_OPEN_FILES_IN_DEFAULT,
  FORK_OPEN_FILES_IN_KEY,
  FORK_OPEN_LINKS_IN_DEFAULT,
  FORK_OPEN_LINKS_IN_KEY,
  ForkOpenFilesIn,
  ForkOpenLinksIn,
  isSafeExternalBrowserUrl,
  resolveForkFileAction,
  resolveLocalFileAbsolutePath,
  shouldInterceptInAppLink,
} from "./externalOpen.logic";

export const readForkOpenLinksIn = (): ForkOpenLinksIn =>
  readLocalStorageValue(FORK_OPEN_LINKS_IN_KEY, FORK_OPEN_LINKS_IN_DEFAULT, ForkOpenLinksIn);

export const useForkOpenLinksIn = () =>
  useLocalStorage(FORK_OPEN_LINKS_IN_KEY, FORK_OPEN_LINKS_IN_DEFAULT, ForkOpenLinksIn);

const readForkOpenFilesIn = (): ForkOpenFilesIn =>
  readLocalStorageValue(FORK_OPEN_FILES_IN_KEY, FORK_OPEN_FILES_IN_DEFAULT, ForkOpenFilesIn);

export const useForkOpenFilesIn = () =>
  useLocalStorage(FORK_OPEN_FILES_IN_KEY, FORK_OPEN_FILES_IN_DEFAULT, ForkOpenFilesIn);

export const shouldForkInterceptInAppLink = (): boolean =>
  shouldInterceptInAppLink(readForkOpenLinksIn());

function canForkOpenLocalFile(environmentId: EnvironmentId | null): boolean {
  if (environmentId === null || typeof window === "undefined") return false;
  if (window.desktopBridge?.forkOpenPath === undefined) return false;
  const hostEnvironmentId = appAtomRegistry.get(hostEnvironmentIdAtom);
  return hostEnvironmentId === null || hostEnvironmentId === environmentId;
}

export async function openForkExternalBrowserUrl(url: string): Promise<boolean> {
  if (!isSafeExternalBrowserUrl(url)) return false;
  const api = readLocalApi();
  if (!api) return false;
  await api.shell.openExternal(url);
  return true;
}

export function shouldForkOpenLocalFile(input: {
  readonly environmentId: EnvironmentId | null;
  readonly altKey?: boolean;
}): boolean {
  return (
    resolveForkFileAction({
      setting: readForkOpenFilesIn(),
      canOpenLocally: canForkOpenLocalFile(input.environmentId),
      ...(input.altKey === undefined ? {} : { altKey: input.altKey }),
    }) === "external"
  );
}

/**
 * Opens a local file in its OS default app when the fork setting is "external".
 * Returns true when this helper handled the click (opened or reported a local error),
 * and false when it ran `fallback` to open the file inside T3 Code instead.
 */
export async function openForkFileOrFallback(input: {
  readonly environmentId: EnvironmentId | null;
  readonly path: string;
  readonly cwd?: string | undefined;
  readonly altKey?: boolean;
  readonly fallback: () => void;
}): Promise<boolean> {
  if (!shouldForkOpenLocalFile(input) || input.environmentId === null) {
    input.fallback();
    return false;
  }

  const absolutePath = resolveLocalFileAbsolutePath({ path: input.path, cwd: input.cwd });
  if (absolutePath === null) {
    input.fallback();
    return false;
  }

  const openPath = window.desktopBridge?.forkOpenPath;
  if (openPath === undefined) {
    input.fallback();
    return false;
  }

  try {
    const result = await openPath({ environmentId: input.environmentId, path: absolutePath });
    if (result.ok) return true;
    if (result.reason === "not-host-environment") {
      input.fallback();
      return false;
    }
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not open file in default app",
        description: result.error ?? absolutePath,
      }),
    );
    return true;
  } catch (error: unknown) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not open file in default app",
        description: error instanceof Error ? error.message : absolutePath,
      }),
    );
    return true;
  }
}
