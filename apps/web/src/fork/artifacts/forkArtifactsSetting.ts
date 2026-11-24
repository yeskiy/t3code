import { useLocalStorage } from "~/hooks/useLocalStorage";

import {
  FORK_ARTIFACTS_ENABLED_DEFAULT,
  FORK_ARTIFACTS_ENABLED_KEY,
  ForkArtifactsEnabled,
} from "./artifacts.logic";

export const useForkArtifactsEnabled = () =>
  useLocalStorage(FORK_ARTIFACTS_ENABLED_KEY, FORK_ARTIFACTS_ENABLED_DEFAULT, ForkArtifactsEnabled);
