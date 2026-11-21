/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { TurnItemId } from "@t3tools/contracts";
import { use, useState } from "react";

import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import type { WorkLogEntry } from "~/session-logic";
import type { ForkMoveTarget } from "./foregroundToolContext";
import { isMovableToolCall } from "./runningToolCall.logic";
import { useForkMoveToolCall, useForkToolBackgroundEnabled } from "./useForkForegroundToolTracker";

function MoveButton(props: { readonly target: ForkMoveTarget }) {
  const move = useForkMoveToolCall();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost-muted"
      size="micro"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        setPending(true);
        void move(props.target).finally(() => setPending(false));
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      Move to background
    </Button>
  );
}

export function ForkMoveToBackgroundButton(props: { readonly entry: WorkLogEntry }) {
  const { threadRef, canOperateThread } = use(TimelineRowCtx);
  const { isWorking } = use(TimelineRowActivityCtx);
  const [enabled] = useForkToolBackgroundEnabled();
  if (threadRef === null || !canOperateThread) return null;
  if (!isMovableToolCall(props.entry, { runLive: isWorking, enabled })) return null;
  return (
    <MoveButton
      target={{
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        itemId: props.entry.id as TurnItemId,
      }}
    />
  );
}
