/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useEffect } from "react";

import { toastManager } from "~/components/ui/toast";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isRichTextBoldShortcut } from "~/keybindings";
import type { TimelineEntry } from "~/session-logic";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  type ForkMoveTarget,
  readForkMoveTarget,
  setForkMoveTarget,
} from "./foregroundToolContext";
import { forkMoveToolCallToBackground } from "./forkToolCallCommands";
import {
  FORK_TOOL_BACKGROUND_KEY,
  ForkToolBackgroundEnabled,
  newestMovableToolCall,
} from "./runningToolCall.logic";

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
      toastManager.add({ type: "error", title: "Could not move the command to the background" });
    }
  };
}

export function useForkForegroundToolTracker(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly runLive: boolean;
  readonly focused: boolean;
}) {
  const [enabled] = useForkToolBackgroundEnabled();
  const { environmentId, threadId, focused } = input;
  const itemId =
    newestMovableToolCall(input.entries, { runLive: input.runLive, enabled })?.id ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the focused thread's running tool call to the keybinding context
  useEffect(() => {
    if (!focused || itemId === null) return;
    setForkMoveTarget({ environmentId, threadId, itemId: itemId as TurnItemId });
    return () => setForkMoveTarget(null);
  }, [focused, environmentId, threadId, itemId]);
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
