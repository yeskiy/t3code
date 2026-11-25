import type { ForkTranscriptOp, ForkTranscriptPendingOp } from "@t3tools/contracts";

export interface Step {
  readonly id: string;
  readonly label: string;
  readonly unitKeys: ReadonlyArray<string>;
  readonly items: ReadonlyArray<ForkTranscriptPendingOp>;
}

export interface History {
  readonly steps: ReadonlyArray<Step>;
  readonly redo: ReadonlyArray<Step>;
}

export type HistoryAction =
  | { readonly type: "add"; readonly step: Step }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "revert"; readonly stepId: string }
  | { readonly type: "restoreUnit"; readonly unitKey: string }
  | { readonly type: "replace"; readonly steps: ReadonlyArray<Step> }
  | { readonly type: "clear" };

export const emptyHistory: History = { steps: [], redo: [] };

const opDeletesOrMovesUnit = (op: ForkTranscriptOp, unitKey: string): boolean => {
  if (op.kind === "deleteUnit" || op.kind === "moveUnit") {
    return op.unit === unitKey;
  }
  if (op.kind === "deleteUnits") {
    return op.units.includes(unitKey);
  }
  return false;
};

const withoutRestoredUnit = (
  pending: ForkTranscriptPendingOp,
  unitKey: string,
): ReadonlyArray<ForkTranscriptPendingOp> => {
  const { op } = pending;
  if ((op.kind === "deleteUnit" || op.kind === "moveUnit") && op.unit === unitKey) {
    return [];
  }
  if (op.kind === "deleteUnits" && op.units.includes(unitKey)) {
    const remaining = op.units.filter((unit) => unit !== unitKey);
    return remaining.length === 0 ? [] : [{ ...pending, op: { ...op, units: remaining } }];
  }
  return [pending];
};

const restoreUnitInHistory = (history: History, unitKey: string): History => {
  const targetIndex = history.steps.findLastIndex((step) =>
    step.items.some((pending) => opDeletesOrMovesUnit(pending.op, unitKey)),
  );
  if (targetIndex < 0) return history;

  const nextSteps = history.steps.flatMap((step, index) => {
    if (index !== targetIndex) return [step];
    const nextItems = step.items.flatMap((pending) => withoutRestoredUnit(pending, unitKey));
    if (nextItems.length === 0) return [];
    const nextUnitKeys = step.unitKeys.filter((key) => key !== unitKey);
    return [{ ...step, unitKeys: nextUnitKeys, items: nextItems }];
  });
  return { steps: nextSteps, redo: [] };
};

export const historyReducer = (history: History, action: HistoryAction): History => {
  switch (action.type) {
    case "add":
      return { steps: [...history.steps, action.step], redo: [] };
    case "undo": {
      const last = history.steps.at(-1);
      if (last === undefined) return history;
      return { steps: history.steps.slice(0, -1), redo: [last, ...history.redo] };
    }
    case "redo": {
      const [first, ...rest] = history.redo;
      if (first === undefined) return history;
      return { steps: [...history.steps, first], redo: rest };
    }
    case "revert": {
      const nextSteps = history.steps.filter((step) => step.id !== action.stepId);
      return nextSteps.length === history.steps.length ? history : { steps: nextSteps, redo: [] };
    }
    case "restoreUnit":
      return restoreUnitInHistory(history, action.unitKey);
    case "replace":
      return { steps: action.steps, redo: [] };
    case "clear":
      return emptyHistory;
  }
};

export const flatOps = (history: History): ReadonlyArray<ForkTranscriptPendingOp> =>
  history.steps.flatMap((step) => step.items);
