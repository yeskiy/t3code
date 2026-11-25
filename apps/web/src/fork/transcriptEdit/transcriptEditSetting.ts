import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

export const FORK_TRANSCRIPT_EDIT_ENABLED_KEY = "t3code:fork:transcript-edit:v1";
const FORK_TRANSCRIPT_EDIT_ENABLED_DEFAULT = true;

export const useForkTranscriptEditEnabled = (): readonly [boolean, (next: boolean) => void] =>
  useLocalStorage(
    FORK_TRANSCRIPT_EDIT_ENABLED_KEY,
    FORK_TRANSCRIPT_EDIT_ENABLED_DEFAULT,
    Schema.Boolean,
  );
