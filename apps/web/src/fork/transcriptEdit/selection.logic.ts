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
  const anchor = orderedKeys[anchorIndex];
  if (selection.keys.size === 0 && anchor !== undefined) return { keys: new Set([anchor]), anchor };

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

export const toggleKeys = (selection: Selection, keys: ReadonlyArray<string>): Selection => {
  const remove = keys.length > 0 && keys.every((key) => selection.keys.has(key));
  return {
    keys: remove
      ? new Set([...selection.keys].filter((key) => !keys.includes(key)))
      : new Set([...selection.keys, ...keys]),
    anchor: keys[0] ?? selection.anchor,
  };
};

const spanKeys = (orderedKeys: ReadonlyArray<string>, keys: ReadonlyArray<string>) => {
  const indexes = keys.map((key) => orderedKeys.indexOf(key)).filter((index) => index >= 0);
  return indexes.length === 0
    ? new Set(keys)
    : rangeKeys(orderedKeys, Math.min(...indexes), Math.max(...indexes));
};

export const rangeSelectKeys = (
  selection: Selection,
  keys: ReadonlyArray<string>,
  orderedKeys: ReadonlyArray<string>,
): Selection =>
  selection.anchor === null || !orderedKeys.includes(selection.anchor)
    ? { keys: new Set(keys), anchor: keys[0] ?? null }
    : { keys: spanKeys(orderedKeys, [selection.anchor, ...keys]), anchor: selection.anchor };

// A drag over rows adds or removes every unit from the start row to the row under the pointer.
export const paintSelection = (
  base: Selection,
  startKeys: ReadonlyArray<string>,
  currentKeys: ReadonlyArray<string>,
  orderedKeys: ReadonlyArray<string>,
  mode: "add" | "remove",
): Selection => {
  const span = spanKeys(orderedKeys, [...startKeys, ...currentKeys]);
  return {
    keys:
      mode === "add"
        ? new Set([...base.keys, ...span])
        : new Set([...base.keys].filter((key) => !span.has(key))),
    anchor: startKeys[0] ?? base.anchor,
  };
};
