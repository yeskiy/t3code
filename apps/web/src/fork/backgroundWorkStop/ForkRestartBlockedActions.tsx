/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import {
  isClaudeRestartBlockedMessage,
  type RunId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { BotIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { use, useState } from "react";

import { deriveThreadPendingBackgroundTasks } from "~/components/ChatView.logic";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { cn, newMessageId } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import {
  backgroundTaskItem,
  backgroundTaskLabel,
  backgroundTaskStopRoute,
  endsWithClaudeRestart,
} from "./backgroundTaskStop.logic";
import { ForkBackgroundTaskStopButton } from "./ForkBackgroundTaskStop";
import { useForkBackgroundTaskStop } from "./useForkBackgroundTaskStop";

const STOP_WAIT_MS = 20_000;
const POLL_MS = 500;

/** Resolves true once none of `taskIds` is pending, or false at the deadline. */
const waitUntilEnded = (
  readPendingTaskIds: () => ReadonlySet<string>,
  taskIds: ReadonlyArray<string>,
  deadline: number,
): Promise<boolean> => {
  const pending = readPendingTaskIds();
  if (!taskIds.some((taskId) => pending.has(taskId))) return Promise.resolve(true);
  if (Date.now() >= deadline) return Promise.resolve(false);
  return new Promise((resolve) => setTimeout(resolve, POLL_MS)).then(() =>
    waitUntilEnded(readPendingTaskIds, taskIds, deadline),
  );
};

const waitForEnd = (
  readPendingTaskIds: () => ReadonlySet<string>,
  taskIds: ReadonlyArray<string>,
) => waitUntilEnded(readPendingTaskIds, taskIds, Date.now() + STOP_WAIT_MS);

/** The blockers of a failed run, each with Stop, and one action that stops all and resends. */
export function ForkRestartBlockedPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly runId: RunId;
  readonly canOperate: boolean;
  readonly projection: ThreadStructure | null;
  readonly readPendingTaskIds: () => ReadonlySet<string>;
}) {
  const { threadRef, runId, projection } = props;
  const stop = useForkBackgroundTaskStop(threadRef.environmentId);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [phase, setPhase] = useState<"idle" | "stopping" | "waiting">("idle");
  const turnItems = projection?.turnItems ?? [];
  const blockers = deriveThreadPendingBackgroundTasks(projection).flatMap((task) => {
    const route = backgroundTaskStopRoute({ threadId: threadRef.threadId, task, turnItems });
    const item = backgroundTaskItem(task, turnItems);
    return route !== null && endsWithClaudeRestart(route, item)
      ? [{ task, route, item, label: backgroundTaskLabel(task, item) }]
      : [];
  });
  const run = projection?.runs.find((candidate) => candidate.id === runId);
  const message = projection?.messages.find((candidate) => candidate.id === run?.userMessageId);
  if (
    projection === null ||
    run === undefined ||
    projection.runs.at(-1)?.id !== runId ||
    blockers.length === 0
  ) {
    return null;
  }

  const stopAllAndResend = async () => {
    if (message === undefined) return;
    setPhase("stopping");
    const sent = await Promise.all(blockers.map((blocker) => stop(blocker.route, blocker.label)));
    if (sent.includes(false)) return setPhase("idle");
    setPhase("waiting");
    const ended = await waitForEnd(
      props.readPendingTaskIds,
      blockers.map((blocker) => blocker.task.taskId),
    );
    setPhase("idle");
    if (!ended) {
      toastManager.add({
        type: "warning",
        title: "The background tasks did not stop in time",
        description: "Send the message again after they end.",
      });
      return;
    }
    const result = await startTurn({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: message.text,
          attachments: message.attachments,
          ...(message.context === undefined ? {} : { context: message.context }),
        },
        modelSelection: run.modelSelection,
        runtimeMode: projection.thread.runtimeMode,
        interactionMode: projection.thread.interactionMode,
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not send the message again",
        description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? undefined,
      });
    }
  };

  return (
    <div className="ms-7 space-y-2 pt-1 pb-1">
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-muted/20">
        {blockers.map((blocker) => (
          <li
            key={blocker.task.taskId}
            className="flex items-center gap-2 py-1 ps-2.5 pe-1 text-xs"
          >
            {blocker.route.kind === "subagent" ? (
              <BotIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <TerminalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <SharedTooltipTrigger
              render={
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    blocker.route.kind !== "subagent" && "font-mono",
                  )}
                />
              }
              label={blocker.label}
            >
              {blocker.label}
            </SharedTooltipTrigger>
            <span className="shrink-0 text-muted-foreground">
              {blocker.route.kind === "subagent" ? "agent" : "command"}
            </span>
            <ForkBackgroundTaskStopButton
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              task={blocker.task}
              turnItems={turnItems}
              label={blocker.label}
            />
          </li>
        ))}
      </ul>
      {props.canOperate && message !== undefined ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={phase !== "idle"}
          onClick={() => void stopAllAndResend()}
        >
          {phase !== "idle" ? (
            <Spinner aria-hidden size="xs" />
          ) : (
            <SquareIcon aria-hidden className="size-3 fill-current" />
          )}
          {phase === "stopping"
            ? "Stopping..."
            : phase === "waiting"
              ? "Waiting for the tasks to end..."
              : blockers.length === 1
                ? "Stop it and send again"
                : "Stop these and send again"}
        </Button>
      ) : null}
    </div>
  );
}

/** Under a failed run that Claude background work blocked: Stop each blocker, or all and resend. */
export function ForkRestartBlockedActions(props: {
  readonly runId: RunId | null;
  readonly message: string;
}) {
  const { threadRef, canOperateThread } = use(TimelineRowCtx);
  if (threadRef === null || props.runId === null || !isClaudeRestartBlockedMessage(props.message)) {
    return null;
  }
  return (
    <ThreadRestartBlockedPanel
      threadRef={threadRef}
      runId={props.runId}
      canOperate={canOperateThread}
    />
  );
}

function ThreadRestartBlockedPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly runId: RunId;
  readonly canOperate: boolean;
}) {
  const projection = useAtomValue(
    environmentThreadDetails.threadAtom(props.threadRef),
    (thread) => thread?.projection ?? null,
  );
  return (
    <ForkRestartBlockedPanel
      {...props}
      projection={projection}
      readPendingTaskIds={() =>
        new Set(
          deriveThreadPendingBackgroundTasks(
            appAtomRegistry.get(environmentThreadDetails.threadAtom(props.threadRef))?.projection ??
              null,
          ).map((task) => task.taskId),
        )
      }
    />
  );
}
