import { useAtomValue } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { PencilIcon } from "lucide-react";
import type { RefObject } from "react";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { emptyEditSession, forkTranscriptEditSessionAtom } from "./editSession";
import { ForkTranscriptChangesPopover } from "./ForkTranscriptChangesPopover";
import {
  ForkTranscriptSaveBarActions,
  ForkTranscriptSaveBarValidation,
} from "./ForkTranscriptSaveBar";

const FORK_TRANSCRIPT_SAVE_BAR_ID = "fork-transcript-save-bar";
const SEND_BLOCK = "Save or discard the transcript changes to send a message.";
const EMPTY_ITEMS: ReadonlyArray<ComposerBannerStackItem> = [];
const NO_THREAD_ATOM = Atom.make(emptyEditSession).pipe(Atom.keepAlive);

const useSessionFlag = (
  threadKey: string | null,
  select: (session: typeof emptyEditSession) => boolean,
): boolean =>
  useAtomValue(
    threadKey === null ? NO_THREAD_ATOM : forkTranscriptEditSessionAtom(threadKey),
    select,
  );

// The bar shows while the thread has pending steps or the Select mode is on.
export const useForkTranscriptBannerItems = (
  threadKey: string | null,
  threadRef: ScopedThreadRef | null,
  listRef: RefObject<LegendListRef | null>,
): ReadonlyArray<ComposerBannerStackItem> => {
  const visible = useSessionFlag(
    threadKey,
    (session) => session.history.steps.length > 0 || session.selectMode,
  );
  if (!visible || threadKey === null || threadRef === null) return EMPTY_ITEMS;
  return [
    {
      id: FORK_TRANSCRIPT_SAVE_BAR_ID,
      variant: "default",
      icon: <PencilIcon className="size-3.5" aria-hidden="true" />,
      title: (
        <ForkTranscriptChangesPopover
          threadKey={threadKey}
          threadRef={threadRef}
          listRef={listRef}
        />
      ),
      description: <ForkTranscriptSaveBarValidation threadKey={threadKey} />,
      actions: <ForkTranscriptSaveBarActions threadKey={threadKey} threadRef={threadRef} />,
    },
  ];
};

export const useForkTranscriptSendBlock = (threadKey: string | null): string | null =>
  useSessionFlag(threadKey, (session) => session.history.steps.length > 0) ? SEND_BLOCK : null;
