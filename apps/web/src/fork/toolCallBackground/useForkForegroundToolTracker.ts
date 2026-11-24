/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ForkToolCallControlError,
  type EnvironmentId,
  type ThreadId,
  type TurnItemId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { toastManager } from "~/components/ui/toast";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isRichTextBoldShortcut } from "~/keybindings";
import type { TimelineEntry } from "~/session-logic";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  type ForkMoveTarget,
  readForkMoveTarget,
  readForkStopTarget,
  setForkMoveTarget,
  setForkStopTarget,
} from "./foregroundToolContext";
import { forkMoveToolCallToBackground, forkStopToolCall } from "./forkToolCallCommands";
import {
  FORK_TOOL_BACKGROUND_KEY,
  ForkToolBackgroundEnabled,
  newestMovableToolCall,
  newestStoppableToolCall,
} from "./runningToolCall.logic";

const isForkToolCallControlError = Schema.is(ForkToolCallControlError);

const moveFailureTitle = (error: unknown): string => {
  if (!isForkToolCallControlError(error)) {
    return "Could not move the command to the background";
  }
  switch (error.reason) {
    case "not-running":
      return "That task is no longer running in the foreground";
    case "unsupported":
      return "This tool call cannot be moved to the background";
    case "unavailable":
      return "The Claude session is not active";
    default:
      return "Could not move the command to the background";
  }
};

const stopFailureTitle = (error: unknown): string => {
  if (!isForkToolCallControlError(error)) {
    return "Could not stop the command";
  }
  switch (error.reason) {
    case "not-running":
      return "That task is no longer running";
    case "unsupported":
      return "This tool call cannot be stopped directly";
    case "unavailable":
      return "The Claude session is not active";
    default:
      return "Could not stop the command";
  }
};

export const useForkToolBackgroundEnabled = () =>
  useLocalStorage(FORK_TOOL_BACKGROUND_KEY, true, ForkToolBackgroundEnabled);

export function useForkMoveToolCall() {
  const move = useAtomCommand(forkMoveToolCallToBackground);
  return async (target: ForkMoveTarget) => {
    const result = await move({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, itemId: target.itemId },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: moveFailureTitle(squashAtomCommandFailure(result)),
      });
    }
  };
}

export function useForkForegroundToolTracker(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly runLive: boolean;
  readonly turnWaitingOnly?: boolean;
  readonly focused: boolean;
}) {
  const [enabled] = useForkToolBackgroundEnabled();
  const { environmentId, threadId, focused } = input;
  const eligibility = {
    runLive: input.runLive,
    enabled,
    ...(input.turnWaitingOnly === undefined ? {} : { turnWaitingOnly: input.turnWaitingOnly }),
  };
  const moveItemId = newestMovableToolCall(input.entries, eligibility)?.id ?? null;
  const stopItemId = newestStoppableToolCall(input.entries, eligibility)?.id ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the focused thread's running tool call to the keybinding context
  useEffect(() => {
    if (!focused || (moveItemId === null && stopItemId === null)) return;
    setForkMoveTarget(
      moveItemId === null ? null : { environmentId, threadId, itemId: moveItemId as TurnItemId },
    );
    setForkStopTarget(
      stopItemId === null ? null : { environmentId, threadId, itemId: stopItemId as TurnItemId },
    );
    return () => {
      setForkMoveTarget(null);
      setForkStopTarget(null);
    };
  }, [focused, environmentId, threadId, moveItemId, stopItemId]);
}

export function useForkStopToolCall() {
  const stop = useAtomCommand(forkStopToolCall);
  return async (target: ForkMoveTarget) => {
    const result = await stop({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, itemId: target.itemId },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: stopFailureTitle(squashAtomCommandFailure(result)),
      });
    }
  };
}

export function useForkStopToolCallShortcut() {
  const stop = useForkStopToolCall();
  return (event: KeyboardEvent): boolean => {
    const target = readForkStopTarget();
    if (target === null) return false;
    if (!event.repeat) void stop(target);
    return true;
  };
}

export function useForkMoveToBackgroundShortcut() {
  const move = useForkMoveToolCall();
  return (event: KeyboardEvent): boolean => {
    const target = readForkMoveTarget();
    if (target === null) return false;
    // The rich-text composer keeps Mod+B to bold selected text, as the sidebar toggle does.
    if (
      isRichTextBoldShortcut(event, window.getSelection()) &&
      event.target instanceof HTMLElement &&
      event.target.closest('[data-composer-rich-text="true"]')
    ) {
      return false;
    }
    if (!event.repeat) void move(target);
    return true;
  };
}
