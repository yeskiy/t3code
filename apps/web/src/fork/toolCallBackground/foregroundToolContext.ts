import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";

export interface ForkMoveTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}

// The focused thread's newest movable tool call. useForkForegroundToolTracker writes it.
const store: { target: ForkMoveTarget | null } = { target: null };

export const setForkMoveTarget = (next: ForkMoveTarget | null) => {
  store.target = next;
};
export const readForkMoveTarget = () => store.target;

// Read by resolveContext, so every shortcut resolution sees the identifier.
export const readForkShortcutContext = () => ({ foregroundToolRunning: store.target !== null });
