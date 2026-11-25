export interface Selection {
  readonly keys: ReadonlySet<string>;
  readonly anchor: string | null;
}

export const emptySelection: Selection = { keys: new Set(), anchor: null };

const rangeKeys = (
  orderedKeys: ReadonlyArray<string>,
  fromIndex: number,
  toIndex: number,
): ReadonlySet<string> => {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return new Set(orderedKeys.slice(start, end + 1));
};

export const toggleSelect = (selection: Selection, key: string): Selection => {
  const nextKeys = new Set(selection.keys);
  if (nextKeys.has(key)) {
    nextKeys.delete(key);
  } else {
    nextKeys.add(key);
  }
  return { keys: nextKeys, anchor: key };
};

export const rangeSelect = (
  selection: Selection,
  key: string,
  orderedKeys: ReadonlyArray<string>,
): Selection => {
  const targetIndex = orderedKeys.indexOf(key);
  if (targetIndex < 0) {
    return { keys: new Set([key]), anchor: key };
  }
  const anchorIndex = selection.anchor === null ? -1 : orderedKeys.indexOf(selection.anchor);
  if (anchorIndex < 0) {
    return { keys: new Set([key]), anchor: key };
  }
  return {
    keys: rangeKeys(orderedKeys, anchorIndex, targetIndex),
    anchor: selection.anchor,
  };
};

const isContiguousSelection = (
  orderedKeys: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  start: number,
  end: number,
): boolean => {
  if (selected.size !== end - start + 1) return false;
  return orderedKeys.slice(start, end + 1).every((key) => selected.has(key));
};

export const extendSelection = (
  selection: Selection,
  direction: 1 | -1,
  orderedKeys: ReadonlyArray<string>,
): Selection => {
  if (orderedKeys.length === 0) return selection;
  const anchorIndex = selection.anchor === null ? -1 : orderedKeys.indexOf(selection.anchor);
  if (anchorIndex < 0) {
    const first = orderedKeys[0];
    return first === undefined ? selection : { keys: new Set([first]), anchor: first };
  }

  const selectedIndices = orderedKeys.flatMap((key, index) =>
    selection.keys.has(key) ? [index] : [],
  );
  const minIndex = selectedIndices[0];
  const maxIndex = selectedIndices.at(-1);
  const edgeIndex =
    minIndex !== undefined &&
    maxIndex !== undefined &&
    maxIndex > anchorIndex &&
    minIndex === anchorIndex &&
    isContiguousSelection(orderedKeys, selection.keys, minIndex, maxIndex)
      ? maxIndex
      : minIndex !== undefined &&
          maxIndex !== undefined &&
          minIndex < anchorIndex &&
          maxIndex === anchorIndex &&
          isContiguousSelection(orderedKeys, selection.keys, minIndex, maxIndex)
        ? minIndex
        : anchorIndex;

  const nextEdge = Math.min(orderedKeys.length - 1, Math.max(0, edgeIndex + direction));
  return {
    keys: rangeKeys(orderedKeys, anchorIndex, nextEdge),
    anchor: selection.anchor,
  };
};

export const selectAll = (orderedKeys: ReadonlyArray<string>): Selection => ({
  keys: new Set(orderedKeys),
  anchor: orderedKeys[0] ?? null,
});

export const pruneSelection = (
  selection: Selection,
  orderedKeys: ReadonlyArray<string>,
): Selection => {
  const live = new Set(orderedKeys);
  return {
    keys: new Set([...selection.keys].filter((key) => live.has(key))),
    anchor: selection.anchor !== null && live.has(selection.anchor) ? selection.anchor : null,
  };
};
