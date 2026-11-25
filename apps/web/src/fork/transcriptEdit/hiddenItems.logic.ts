export const withoutForkHiddenItems = <
  T extends { readonly item: { readonly forkTranscriptHidden?: true } },
>(
  items: ReadonlyArray<T>,
): ReadonlyArray<T> => {
  if (!items.some((entry) => entry.item.forkTranscriptHidden === true)) {
    return items;
  }
  return items.filter((entry) => entry.item.forkTranscriptHidden !== true);
};
