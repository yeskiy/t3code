/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { OrchestrationV2TurnItem, TurnItemId } from "@t3tools/contracts";
import { use, useState } from "react";

import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import type { WorkLogEntry } from "~/session-logic";
import type { ForkMoveTarget } from "./foregroundToolContext";
import { isMovableToolCall, isMovableTurnItem } from "./runningToolCall.logic";
import {
  useForkMoveToolCall,
  useForkStopToolCall,
  useForkToolBackgroundEnabled,
} from "./useForkForegroundToolTracker";

function ToolCallActionButtons(props: { readonly target: ForkMoveTarget }) {
  const move = useForkMoveToolCall();
  const stop = useForkStopToolCall();
  const [pending, setPending] = useState(false);
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
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
      <Button
        variant="ghost-destructive"
        size="micro"
        aria-label="Stop this command"
        title="Stop this command"
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          setPending(true);
          void stop(props.target).finally(() => setPending(false));
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        Stop
      </Button>
    </span>
  );
}

type ForkMoveToBackgroundButtonProps =
  | { readonly entry: WorkLogEntry; readonly item?: undefined }
  | { readonly entry?: undefined; readonly item: OrchestrationV2TurnItem };

export function ForkMoveToBackgroundButton(props: ForkMoveToBackgroundButtonProps) {
  const { threadRef, canOperateThread } = use(TimelineRowCtx);
  const { isWorking } = use(TimelineRowActivityCtx);
  const [enabled] = useForkToolBackgroundEnabled();
  if (threadRef === null || !canOperateThread) return null;
  const movable =
    props.entry !== undefined
      ? isMovableToolCall(props.entry, { runLive: isWorking, enabled })
      : isMovableTurnItem(props.item, { runLive: isWorking, enabled });
  if (!movable) return null;
  const itemId = (props.entry !== undefined ? props.entry.id : props.item.id) as TurnItemId;
  return (
    <ToolCallActionButtons
      target={{
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        itemId,
      }}
    />
  );
}
