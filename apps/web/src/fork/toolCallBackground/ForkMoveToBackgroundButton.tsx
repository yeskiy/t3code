/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { useAtomValue } from "@effect/atom-react";
import { deriveThreadStructureRuntime } from "@t3tools/client-runtime/state/thread-execution";
import type { OrchestrationV2TurnItem, ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { use, useState } from "react";

import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import type { WorkLogEntry } from "~/session-logic";
import { environmentThreadDetails } from "~/state/threads";
import type { ForkMoveTarget } from "./foregroundToolContext";
import {
  isMovableToolCall,
  isMovableTurnItem,
  isStoppableToolCall,
  isStoppableTurnItem,
} from "./runningToolCall.logic";
import {
  useForkMoveToolCall,
  useForkStopToolCall,
  useForkToolBackgroundEnabled,
} from "./useForkForegroundToolTracker";

function ToolCallActionButtons(props: {
  readonly target: ForkMoveTarget;
  readonly movable: boolean;
  readonly stoppable: boolean;
}) {
  const move = useForkMoveToolCall();
  const stop = useForkStopToolCall();
  const [pending, setPending] = useState(false);
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {props.movable ? (
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
      ) : null}
      {props.stoppable ? (
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
      ) : null}
    </span>
  );
}

function SubagentActionButtons(props: {
  readonly threadRef: ScopedThreadRef;
  readonly item: OrchestrationV2TurnItem;
  readonly isWorking: boolean;
  readonly enabled: boolean;
}) {
  const turnWaitingOnly = useAtomValue(
    environmentThreadDetails.threadAtom(props.threadRef),
    (thread) =>
      thread != null && deriveThreadStructureRuntime(thread.projection)?.status === "waiting",
  );
  const input = { runLive: props.isWorking, enabled: props.enabled, turnWaitingOnly };
  const movable = isMovableTurnItem(props.item, input);
  const stoppable = isStoppableTurnItem(props.item, input);
  if (!movable && !stoppable) return null;
  return (
    <ToolCallActionButtons
      target={{
        environmentId: props.threadRef.environmentId,
        threadId: props.threadRef.threadId,
        itemId: props.item.id as TurnItemId,
      }}
      movable={movable}
      stoppable={stoppable}
    />
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
  if (props.entry === undefined && props.item.type === "subagent") {
    return (
      <SubagentActionButtons
        threadRef={threadRef}
        item={props.item}
        isWorking={isWorking}
        enabled={enabled}
      />
    );
  }
  const input = { runLive: isWorking, enabled };
  const movable =
    props.entry !== undefined
      ? isMovableToolCall(props.entry, input)
      : isMovableTurnItem(props.item, input);
  const stoppable =
    props.entry !== undefined
      ? isStoppableToolCall(props.entry, input)
      : isStoppableTurnItem(props.item, input);
  if (!movable && !stoppable) return null;
  const itemId = (props.entry !== undefined ? props.entry.id : props.item.id) as TurnItemId;
  return (
    <ToolCallActionButtons
      target={{
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        itemId,
      }}
      movable={movable}
      stoppable={stoppable}
    />
  );
}
