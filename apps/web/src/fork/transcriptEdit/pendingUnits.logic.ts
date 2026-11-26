import type { ForkTranscriptOp, ForkTranscriptUnitView } from "@t3tools/contracts";

import type { Step } from "./history.logic";

type Units = ReadonlyArray<ForkTranscriptUnitView>;

export interface PendingUnitsSource {
  readonly load: { readonly units: Units } | null;
  readonly preview: { readonly units: Units } | null;
  readonly previewSteps: ReadonlyArray<Step>;
  readonly history: { readonly steps: ReadonlyArray<Step> };
}

const leadingLocked = (units: Units) => {
  const index = units.findIndex((unit) => !unit.locked);
  return index < 0 ? units.length : index;
};

// Mirrors the server rules for the ops that only change the unit order. Others return null.
const applyLocally = (units: Units | null, op: ForkTranscriptOp): Units | null => {
  if (units === null) return null;
  switch (op.kind) {
    case "deleteUnit":
      return units.filter((unit) => unit.key !== op.unit);
    case "deleteUnits":
      return units.filter((unit) => !op.units.includes(unit.key));
    case "moveUnit": {
      const unit = units.find((candidate) => candidate.key === op.unit);
      const rest = units.filter((candidate) => candidate !== unit);
      return unit === undefined || op.toIndex > rest.length || op.toIndex < leadingLocked(units)
        ? null
        : [...rest.slice(0, op.toIndex), unit, ...rest.slice(op.toIndex)];
    }
    case "editUserText":
    case "editAssistantText":
    case "editSystemContent":
      return units;
    case "removeThinking":
    case "insertMessage":
      return null;
  }
};

const replay = (units: Units, steps: ReadonlyArray<Step>) =>
  steps
    .flatMap((step) => step.items)
    .reduce<Units | null>((acc, { op }) => applyLocally(acc, op), units);

/** The unit order with every pending step applied, or null until the server preview catches up. */
export const pendingUnits = (session: PendingUnitsSource): Units | null => {
  if (session.load === null) return [];
  const { steps } = session.history;
  const covered = session.preview === null ? [] : session.previewSteps;
  const extendsPreview =
    covered.length <= steps.length && covered.every((step, index) => steps[index] === step);
  return (
    (extendsPreview
      ? replay(session.preview?.units ?? session.load.units, steps.slice(covered.length))
      : null) ?? replay(session.load.units, steps)
  );
};
