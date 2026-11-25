import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  ForkTranscriptEditError,
  OrchestrationV2Run,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { useContext } from "react";

import { registerThreadOverlay } from "~/components/chat/threadOverlayRetention";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";
import {
  createForkTranscriptEditActions,
  forkTranscriptEditSessionAtom,
  toEditError,
} from "./editSession";
import { flatOps, type Step } from "./history.logic";
import { saveToast } from "./saveRefusal.logic";
import { forkTranscriptSave } from "./transcriptEditRpc";

export interface ForkTranscriptSaveBarState {
  readonly saving: boolean;
  readonly refusal: ForkTranscriptEditError | null;
  readonly dropped: ReadonlyArray<Step> | null;
  readonly popover: "changes" | "errors" | null;
  readonly review: boolean;
  readonly discard: boolean;
}

const EMPTY_STATE: ForkTranscriptSaveBarState = {
  saving: false,
  refusal: null,
  dropped: null,
  popover: null,
  review: false,
  discard: false,
};

const trackedStates = new Map<string, Atom.Writable<ForkTranscriptSaveBarState>>();

const stateFamily = Atom.family((threadKey: string) =>
  Atom.make(EMPTY_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`fork:transcript-edit:save-bar:${threadKey}`),
  ),
);

const forkTranscriptSaveBarAtom = (threadKey: string) => {
  const atom = stateFamily(threadKey);
  trackedStates.set(threadKey, atom);
  return atom;
};

// A thread switch closes the open overlays. A refusal stays, so the owner sees it on return.
registerThreadOverlay((activeThreadKey) => {
  trackedStates.forEach((atom, threadKey) => {
    const current = appAtomRegistry.get(atom);
    if (threadKey === activeThreadKey || (current.popover === null && !current.review)) return;
    appAtomRegistry.set(atom, { ...current, popover: null, review: false, discard: false });
  });
});

export const patchSaveBar = (
  registry: AtomRegistry.AtomRegistry,
  threadKey: string,
  patch: Partial<ForkTranscriptSaveBarState>,
): void => {
  const atom = forkTranscriptSaveBarAtom(threadKey);
  registry.set(atom, { ...registry.get(atom), ...patch });
};

export const useForkTranscriptSaveBarState = (threadKey: string): ForkTranscriptSaveBarState =>
  useAtomValue(forkTranscriptSaveBarAtom(threadKey));

const WORKING_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export const useForkThreadWorking = (threadRef: ScopedThreadRef): boolean =>
  useAtomValue(
    environmentThreadDetails.threadAtom(threadRef),
    (thread) => thread?.projection.runs.some((run) => WORKING_STATUSES.has(run.status)) ?? false,
  );

const saveForkTranscript = async (input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly confirmStop: boolean;
}): Promise<void> => {
  const { registry, threadKey, threadRef } = input;
  const session = registry.get(forkTranscriptEditSessionAtom(threadKey));
  if (session.load === null || session.history.steps.length === 0) return;
  patchSaveBar(registry, threadKey, { saving: true, refusal: null, popover: null, review: false });
  const result = await runAtomCommand(
    registry,
    forkTranscriptSave,
    {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        baseKey: session.load.baseKey,
        ops: flatOps(session.history),
        confirmStop: input.confirmStop,
        after: session.after,
      },
    },
    { reportFailure: false, reportDefect: false },
  );
  if (result._tag === "Failure") {
    patchSaveBar(registry, threadKey, {
      saving: false,
      refusal: toEditError(result.cause, "writeFailed"),
    });
    return;
  }
  const toast = saveToast(result.value);
  toastManager.add({
    type: "success",
    title: toast.title,
    ...(toast.description === null ? {} : { description: toast.description }),
  });
  createForkTranscriptEditActions({ registry, threadKey, threadRef }).discard();
  patchSaveBar(registry, threadKey, EMPTY_STATE);
};

export const useForkTranscriptSave = (threadKey: string, threadRef: ScopedThreadRef) => {
  const registry = useContext(RegistryContext);
  return (confirmStop: boolean) =>
    saveForkTranscript({ registry, threadKey, threadRef, confirmStop });
};
