import type { ForkTranscriptOp, ForkTranscriptUnitView } from "@t3tools/contracts";

import type { Step } from "./history.logic";
import type { Selection } from "./selection.logic";

type Units = ReadonlyArray<ForkTranscriptUnitView>;
type MoveTarget = { readonly afterKey: string | null } | { readonly direction: 1 | -1 };

export const selectableUnitKeys = (units: Units): ReadonlyArray<string> =>
  units.flatMap((unit) => (unit.locked ? [] : [unit.key]));

const pickedKeys = (units: Units, keys: ReadonlySet<string>) =>
  selectableUnitKeys(units).filter((key) => keys.has(key));

const countLabel = (verb: string, count: number) =>
  count === 1 ? `${verb} message` : `${verb} ${count} messages`;

const makeStep = (
  label: string,
  unitKeys: ReadonlyArray<string>,
  ops: ReadonlyArray<ForkTranscriptOp>,
): Omit<Step, "id"> => {
  const at = new Date().toISOString();
  return { label, unitKeys, items: ops.map((op) => ({ op, at })) };
};

export const bulkDeleteStep = (
  units: Units,
  keys: ReadonlySet<string>,
): Omit<Step, "id"> | null => {
  const picked = pickedKeys(units, keys);
  return picked.length === 0
    ? null
    : makeStep(countLabel("Deleted", picked.length), picked, [
        { kind: "deleteUnits", units: picked },
      ]);
};

const leadingLockedCount = (units: Units) => {
  const index = units.findIndex((unit) => !unit.locked);
  return index < 0 ? units.length : index;
};

// Each selected unit swaps with its unselected neighbor, so a block keeps its order.
const shiftedOrder = (units: Units, picked: ReadonlySet<string>, direction: 1 | -1) => {
  const barrier = leadingLockedCount(units);
  const keys = units.map((unit) => unit.key);
  const indexes = keys.map((_, index) => index);
  return (direction === -1 ? indexes : indexes.toReversed()).reduce<ReadonlyArray<string>>(
    (order, index) => {
      const neighbor = index + direction;
      const key = order[index];
      const other = order[neighbor];
      if (key === undefined || other === undefined || neighbor < barrier) return order;
      if (!picked.has(key) || picked.has(other)) return order;
      return order.map((value, at) => (at === index ? other : at === neighbor ? key : value));
    },
    keys,
  );
};

const placedOrder = (units: Units, picked: ReadonlySet<string>, afterKey: string | null) => {
  const keys = units.map((unit) => unit.key);
  const rest = keys.filter((key) => !picked.has(key));
  const anchorIndex =
    afterKey === null
      ? -1
      : keys.slice(0, keys.indexOf(afterKey) + 1).findLastIndex((key) => !picked.has(key));
  const insertAt =
    anchorIndex < 0
      ? Math.min(leadingLockedCount(units), rest.length)
      : rest.indexOf(keys[anchorIndex] ?? "") + 1;
  const moved = keys.filter((key) => picked.has(key));
  return [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)];
};

// Moves each picked unit right after its predecessor in the final order, so only picked units move.
const movesToReach = (
  start: ReadonlyArray<string>,
  target: ReadonlyArray<string>,
  picked: ReadonlySet<string>,
) =>
  target.reduce<{
    readonly order: ReadonlyArray<string>;
    readonly ops: ReadonlyArray<ForkTranscriptOp>;
  }>(
    (acc, key, targetIndex) => {
      if (!picked.has(key)) return acc;
      const previous = targetIndex === 0 ? null : (target[targetIndex - 1] ?? null);
      const rest = acc.order.filter((value) => value !== key);
      const toIndex = previous === null ? 0 : rest.indexOf(previous) + 1;
      if (acc.order[toIndex] === key) return acc;
      return {
        order: [...rest.slice(0, toIndex), key, ...rest.slice(toIndex)],
        ops: [...acc.ops, { kind: "moveUnit", unit: key, toIndex }],
      };
    },
    { order: start, ops: [] },
  ).ops;

export const bulkMoveStep = (
  units: Units,
  keys: ReadonlySet<string>,
  target: MoveTarget,
): Omit<Step, "id"> | null => {
  const picked = new Set(pickedKeys(units, keys));
  if (picked.size === 0) return null;
  const ops = movesToReach(
    units.map((unit) => unit.key),
    "direction" in target
      ? shiftedOrder(units, picked, target.direction)
      : placedOrder(units, picked, target.afterKey),
    picked,
  );
  return ops.length === 0 ? null : makeStep(countLabel("Moved", picked.size), [...picked], ops);
};

const thinkingTargets = (unit: ForkTranscriptUnitView) =>
  unit.blocks
    .flatMap((block) =>
      block.removable &&
      block.index !== null &&
      (block.type === "thinking" || block.type === "redacted_thinking")
        ? [{ uuid: block.uuid, block: block.index }]
        : [],
    )
    .toSorted((a, b) => (a.uuid === b.uuid ? b.block - a.block : 0));

export const bulkRemoveThinkingStep = (
  units: Units,
  keys: ReadonlySet<string>,
): Omit<Step, "id"> | null => {
  const withThinking = units.flatMap((unit) => {
    if (unit.locked || !keys.has(unit.key)) return [];
    const targets = thinkingTargets(unit);
    return targets.length === 0 ? [] : [{ key: unit.key, targets }];
  });
  if (withThinking.length === 0) return null;
  return makeStep(
    withThinking.length === 1
      ? "Removed thinking"
      : `Removed thinking from ${withThinking.length} messages`,
    withThinking.map((item) => item.key),
    withThinking.flatMap((item) =>
      item.targets.map((target): ForkTranscriptOp => ({ kind: "removeThinking", target })),
    ),
  );
};

export const hasRemovableThinking = (units: Units, keys: ReadonlySet<string>): boolean =>
  units.some((unit) => !unit.locked && keys.has(unit.key) && thinkingTargets(unit).length > 0);

export const dropAfterKey = (
  units: Units,
  targetKeys: ReadonlyArray<string>,
  side: "before" | "after",
): string | null => {
  const indexes = targetKeys
    .map((key) => units.findIndex((unit) => unit.key === key))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return null;
  return side === "after"
    ? (units[Math.max(...indexes)]?.key ?? null)
    : (units[Math.min(...indexes) - 1]?.key ?? null);
};

export const deleteSelection = (
  actions: {
    readonly addStep: (step: Omit<Step, "id">) => void;
    readonly setSelection: (next: Selection) => void;
  },
  units: Units,
  selection: Selection,
): void => {
  const step = bulkDeleteStep(units, selection.keys);
  if (step === null) return;
  const order = selectableUnitKeys(units);
  const last = order.findLastIndex((key) => step.unitKeys.includes(key));
  const kept = (key: string) => !step.unitKeys.includes(key);
  actions.addStep(step);
  // The next kept unit becomes the anchor, so Shift+Arrow continues from the deleted place.
  actions.setSelection({
    keys: new Set([...selection.keys].filter(kept)),
    anchor: order.slice(last + 1).find(kept) ?? order.slice(0, last).findLast(kept) ?? null,
  });
};
