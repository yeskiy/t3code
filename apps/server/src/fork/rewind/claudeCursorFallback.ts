export interface EarlierClaudeCursorMatch {
  readonly cursor: string;
  readonly droppedTurns: number;
}

// Rewind to the newest earlier real cursor when the target turn has none.
export const nearestEarlierClaudeCursor = <
  T extends { readonly ordinal: number; readonly providerThreadId: string },
>(input: {
  readonly targetTurn: T;
  readonly providerThreadTurns: ReadonlyArray<T>;
  readonly cursorOf: (turn: T) => string | null;
  readonly sameSession?: (turn: T) => boolean;
}): EarlierClaudeCursorMatch | null => {
  const earlier = input.providerThreadTurns
    .filter(
      (turn) =>
        turn.providerThreadId === input.targetTurn.providerThreadId &&
        turn.ordinal < input.targetTurn.ordinal &&
        (input.sameSession?.(turn) ?? true),
    )
    .toSorted((left, right) => right.ordinal - left.ordinal);
  const foundIndex = earlier.findIndex((turn) => input.cursorOf(turn) !== null);
  if (foundIndex < 0) return null;
  const cursor = input.cursorOf(earlier[foundIndex]!);
  if (cursor === null) return null;
  return {
    cursor,
    droppedTurns: foundIndex + 1,
  };
};
