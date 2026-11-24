import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";

interface ForkArtifactsStoreState {
  selectedAttachmentIdByThreadKey: Record<string, string | null>;
  selectArtifact: (ref: ScopedThreadRef, attachmentId: string | null) => void;
  clearThread: (ref: ScopedThreadRef) => void;
}

export const useForkArtifactsStore = create<ForkArtifactsStoreState>()((set) => ({
  selectedAttachmentIdByThreadKey: {},
  selectArtifact: (ref, attachmentId) => {
    const key = scopedThreadKey(ref);
    set((state) => {
      if ((state.selectedAttachmentIdByThreadKey[key] ?? null) === attachmentId) return state;
      return {
        selectedAttachmentIdByThreadKey: {
          ...state.selectedAttachmentIdByThreadKey,
          [key]: attachmentId,
        },
      };
    });
  },
  clearThread: (ref) => {
    const key = scopedThreadKey(ref);
    set((state) => {
      if (!(key in state.selectedAttachmentIdByThreadKey)) return state;
      const { [key]: _removed, ...rest } = state.selectedAttachmentIdByThreadKey;
      return { selectedAttachmentIdByThreadKey: rest };
    });
  },
}));

export function selectThreadArtifactId(
  byThreadKey: Readonly<Record<string, string | null>>,
  ref: ScopedThreadRef | null,
): string | null {
  if (ref === null) return null;
  return byThreadKey[scopedThreadKey(ref)] ?? null;
}

export function openArtifactInPanel(ref: ScopedThreadRef, attachmentId: string): void {
  useForkArtifactsStore.getState().selectArtifact(ref, attachmentId);
  useRightPanelStore.getState().open(ref, "artifacts");
}

export function openArtifactsPanel(ref: ScopedThreadRef): void {
  useRightPanelStore.getState().open(ref, "artifacts");
}
