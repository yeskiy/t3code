/** Drops turn items hidden by a transcript edit while keeping item order. */
export const forkVisibleTurnItems = <T extends { readonly forkTranscriptHidden?: true }>(
  items: ReadonlyArray<T>,
): ReadonlyArray<T> => items.filter((item) => item.forkTranscriptHidden !== true);
