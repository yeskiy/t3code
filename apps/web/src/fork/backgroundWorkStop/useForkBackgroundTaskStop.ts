/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import {
  forkStopBackgroundTask,
  forkStopToolCall,
} from "../toolCallBackground/forkToolCallCommands";
import type { BackgroundTaskStopRoute } from "./backgroundTaskStop.logic";

/** Sends one Stop and reports a failure in a toast. Resolves true when the server accepted it. */
export function useForkBackgroundTaskStop(environmentId: EnvironmentId) {
  const stopRoster = useAtomCommand(forkStopBackgroundTask);
  const stopToolCall = useAtomCommand(forkStopToolCall);
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  return async (route: BackgroundTaskStopRoute, label: string): Promise<boolean> => {
    const result =
      route.kind === "subagent"
        ? await interruptTurn({
            environmentId,
            input: { threadId: route.threadId, subagentId: route.subagentId },
          })
        : route.kind === "tool-call"
          ? await stopToolCall({
              environmentId,
              input: { threadId: route.threadId, itemId: route.itemId },
            })
          : await stopRoster({
              environmentId,
              input: { threadId: route.threadId, taskId: route.taskId },
            });
    if (result._tag !== "Failure") return true;
    if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: `Could not stop ${label}`,
        description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? undefined,
      });
    }
    return false;
  };
}
