import "./sharpText.css";

import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  useLocalStorage,
} from "~/hooks/useLocalStorage";
import { FORK_SHARP_TEXT_KEY, ForkSharpTextStored, resolveForkSharpText } from "./sharpText.logic";

const applyForkSharpText = () =>
  document.documentElement.toggleAttribute(
    "data-fork-sharp-text",
    resolveForkSharpText(
      readLocalStorageValue(FORK_SHARP_TEXT_KEY, null, ForkSharpTextStored),
      navigator.platform,
    ),
  );

applyForkSharpText();
subscribeLocalStorageKey(FORK_SHARP_TEXT_KEY, applyForkSharpText);

export const useForkSharpText = () =>
  useLocalStorage(FORK_SHARP_TEXT_KEY, null, ForkSharpTextStored);
