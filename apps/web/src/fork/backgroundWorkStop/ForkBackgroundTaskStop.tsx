/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type OrchestrationV2PendingBackgroundTask,
  type ThreadId,
} from "@t3tools/contracts";
import { SquareIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";
import { Spinner } from "~/components/ui/spinner";
import { useEnvironmentScope } from "~/state/session";
import {
  backgroundTaskItem,
  backgroundTaskLabel,
  backgroundTaskStopRoute,
} from "./backgroundTaskStop.logic";
import { useForkBackgroundTaskStop } from "./useForkBackgroundTaskStop";

interface ForkBackgroundTaskStopProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly task: OrchestrationV2PendingBackgroundTask;
  readonly turnItems: ThreadStructure["turnItems"];
  readonly label?: string;
  /** Keeps the column when this task has no Stop, so the statuses line up. */
  readonly reserveSpace?: boolean;
}

export function ForkBackgroundTaskStopButton(props: ForkBackgroundTaskStopProps) {
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const stop = useForkBackgroundTaskStop(props.environmentId);
  // The task leaves the list once it ends, so a sent Stop stays pending until then.
  const [stopping, setStopping] = useState(false);
  const route = backgroundTaskStopRoute(props);
  if (!canOperate) return null;
  if (route === null) {
    return props.reserveSpace === true ? <span aria-hidden className="size-7 sm:size-6" /> : null;
  }
  const label =
    props.label ?? backgroundTaskLabel(props.task, backgroundTaskItem(props.task, props.turnItems));
  return (
    <SharedTooltipTrigger
      render={
        <Button
          size="icon-xs"
          variant="ghost-destructive"
          aria-label={`Stop ${label}`}
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void stop(route, label).then((sent) => setStopping(sent));
          }}
        />
      }
      label={stopping ? "Stopping" : "Stop only this task"}
    >
      {stopping ? (
        <Spinner aria-hidden size="xs" />
      ) : (
        <SquareIcon aria-hidden className="size-3 fill-current" />
      )}
    </SharedTooltipTrigger>
  );
}

/** Puts the Stop for one task after its status in a Background work row. */
export function ForkBackgroundTaskActions(
  props: ForkBackgroundTaskStopProps & { readonly children: ReactNode },
) {
  const { children, ...stop } = props;
  return (
    <span className="flex shrink-0 items-center gap-2 self-center">
      {children}
      <ForkBackgroundTaskStopButton {...stop} reserveSpace />
    </span>
  );
}
