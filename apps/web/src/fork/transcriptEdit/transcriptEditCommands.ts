/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";
import { useContext } from "react";

import { toastManager } from "~/components/ui/toast";
import { createForkTranscriptEditActions, forkTranscriptEditSessionAtom } from "./editSession";
import { useForkTranscriptEditEnabled } from "./transcriptEditSetting";

type Handler = (context: { readonly event: KeyboardEvent }) => boolean | void;

/** Starts or ends the Select mode. A start loads the transcript and ends again if it fails. */
export const toggleForkTranscriptSelectMode = async (
  registry: AtomRegistry.AtomRegistry,
  threadKey: string,
  threadRef: ScopedThreadRef,
): Promise<void> => {
  const actions = createForkTranscriptEditActions({ registry, threadKey, threadRef });
  const atom = forkTranscriptEditSessionAtom(threadKey);
  if (registry.get(atom).selectMode) {
    actions.setSelectMode(false);
    return;
  }
  actions.setSelectMode(true);
  await actions.ensureLoaded();
  const { error, load } = registry.get(atom);
  if (load !== null || error === null) return;
  actions.setSelectMode(false);
  toastManager.add({
    type: "error",
    title: "Could not start the Select mode",
    description:
      error.code === "not-claude"
        ? "Transcript editing works for Claude threads only."
        : error.detail,
  });
};

/** The command map entries for the Select mode, undo, and redo keys of one thread. */
export const useForkTranscriptCommands = (
  threadKey: string | null,
  threadRef: ScopedThreadRef | null,
): Record<"forkTranscript.selectMode" | "forkTranscript.undo" | "forkTranscript.redo", Handler> => {
  const registry = useContext(RegistryContext);
  const [enabled] = useForkTranscriptEditEnabled();
  const history = () =>
    threadKey === null ? null : registry.get(forkTranscriptEditSessionAtom(threadKey)).history;
  const dispatch = (type: "undo" | "redo") =>
    createForkTranscriptEditActions({ registry, threadKey, threadRef }).dispatchHistory({ type });
  return {
    "forkTranscript.selectMode": ({ event }) => {
      if (!enabled || threadKey === null || threadRef === null) return false;
      if (!event.repeat) void toggleForkTranscriptSelectMode(registry, threadKey, threadRef);
    },
    "forkTranscript.undo": () => {
      if ((history()?.steps.length ?? 0) === 0) return false;
      dispatch("undo");
    },
    "forkTranscript.redo": () => {
      if ((history()?.redo.length ?? 0) === 0) return false;
      dispatch("redo");
    },
  };
};
