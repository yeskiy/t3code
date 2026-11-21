import type { EnvironmentId } from "@t3tools/contracts";

import { readLocalStorageValue, useLocalStorage } from "~/hooks/useLocalStorage";
import type { createScratchProjectActions } from "~/hooks/useScratchProject";
import {
  FORK_NEW_THREAD_DEFAULT,
  FORK_NEW_THREAD_DEFAULT_KEY,
  ForkNewThreadDefault,
} from "./newThreadDefault.logic";

type ScratchActions = Pick<
  ReturnType<typeof createScratchProjectActions>,
  "scratchEnvironmentId" | "startScratchThread"
>;

// A missing or corrupt stored value gives the default.
const readForkNewThreadDefault = (): ForkNewThreadDefault =>
  readLocalStorageValue(FORK_NEW_THREAD_DEFAULT_KEY, FORK_NEW_THREAD_DEFAULT, ForkNewThreadDefault);

export const useForkNewThreadDefault = () =>
  useLocalStorage(FORK_NEW_THREAD_DEFAULT_KEY, FORK_NEW_THREAD_DEFAULT, ForkNewThreadDefault);

// False sends the caller back to its upstream path.
export function startForkScratchThread(
  scratch: ScratchActions,
  contextEnvironmentId: EnvironmentId | null,
  beforeStart?: () => void,
): boolean {
  if (readForkNewThreadDefault() !== "scratch") return false;
  const environmentId = scratch.scratchEnvironmentId(contextEnvironmentId);
  if (environmentId === null) return false;
  beforeStart?.();
  void scratch.startScratchThread(environmentId);
  return true;
}
