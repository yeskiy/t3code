import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";

export interface ForkMoveTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}

// The focused thread's newest movable and stoppable tool calls.
const store: { moveTarget: ForkMoveTarget | null; stopTarget: ForkMoveTarget | null } = {
  moveTarget: null,
  stopTarget: null,
};

export const setForkMoveTarget = (next: ForkMoveTarget | null) => {
  store.moveTarget = next;
};
export const setForkStopTarget = (next: ForkMoveTarget | null) => {
  store.stopTarget = next;
};
export const readForkMoveTarget = () => store.moveTarget;
export const readForkStopTarget = () => store.stopTarget ?? store.moveTarget;

// Read by resolveContext, so every shortcut resolution sees the identifier.
export const readForkShortcutContext = () => ({ foregroundToolRunning: store.moveTarget !== null });
