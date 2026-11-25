/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptPreviewResult, ForkTranscriptUnitView } from "@t3tools/contracts";

import { type Step, stepIndexOfOp } from "./history.logic";
import { makeInsert } from "./insert.logic";
import { type DraftAnchor, type UnitChange, unitChanges } from "./rowChanges.logic";

export const UNIT_KIND_LABEL: Record<ForkTranscriptUnitView["kind"], string> = {
  preamble: "Preamble",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
  system: "System",
};

export type ChangeBadge =
  | "Edited"
  | "Moved"
  | "Moved and edited"
  | "Inserted"
  | "Moved here"
  | "Cannot apply";

export interface StepRef {
  readonly id: string;
  readonly number: number;
  readonly label: string;
}

export interface ThinkingRef {
  readonly uuid: string;
  readonly block: number;
}

export type RowLook =
  | { readonly kind: "plain" }
  | {
      readonly kind: "marker";
      readonly badge: ChangeBadge;
      readonly tone: "primary" | "destructive";
      readonly step: StepRef | null;
      readonly failure: string | null;
      readonly previewText: string | null;
    }
  | {
      readonly kind: "removed";
      readonly badge: "Removed" | "Moved";
      readonly label: string;
      readonly excerpt: string;
      readonly movesAfter: string | null;
      readonly step: StepRef | null;
      readonly restore:
        | { readonly kind: "units"; readonly unitKeys: ReadonlyArray<string> }
        | { readonly kind: "thinking"; readonly blocks: ReadonlyArray<ThinkingRef> };
    };

export interface RowLookInput {
  readonly baseUnits: ReadonlyArray<ForkTranscriptUnitView>;
  readonly preview: ForkTranscriptPreviewResult | null;
  readonly steps: ReadonlyArray<Step>;
  readonly unitKeys: ReadonlyArray<string>;
  readonly nativeIds: ReadonlyArray<string | null>;
}

const PLAIN: RowLook = { kind: "plain" };
const THINKING_ID = /^(.+):thinking:(\d+)$/;
const CHANGE_WORD: Record<UnitChange, ChangeBadge> = {
  edited: "Edited",
  moved: "Moved",
  movedEdited: "Moved and edited",
  removed: "Edited",
  inserted: "Inserted",
};

const stepRef = (steps: ReadonlyArray<Step>, index: number): StepRef | null => {
  const step = steps[index];
  return step === undefined ? null : { id: step.id, number: index + 1, label: step.label };
};

export const newestStepFor = (steps: ReadonlyArray<Step>, unitKeys: ReadonlyArray<string>) =>
  stepRef(
    steps,
    steps.findLastIndex((step) => step.unitKeys.some((key) => unitKeys.includes(key))),
  );

const thinkingRef = (nativeId: string | null): ThinkingRef | null => {
  const match = nativeId === null ? null : THINKING_ID.exec(nativeId);
  return match === null || match[1] === undefined
    ? null
    : { uuid: match[1], block: Number(match[2]) };
};

const findThinking = (units: ReadonlyArray<ForkTranscriptUnitView>, ref: ThinkingRef) =>
  units
    .flatMap((unit) => unit.blocks)
    .find(
      (block) =>
        block.uuid === ref.uuid &&
        block.index === ref.block &&
        (block.type === "thinking" || block.type === "redacted_thinking"),
    );

const isMovedAway = (change: UnitChange | null) =>
  change === "removed" || change === "moved" || change === "movedEdited";

// The text of the row's own entry, or of every text block when the item has no native id.
const previewTextOf = (unit: ForkTranscriptUnitView | undefined, nativeId: string | null) => {
  if (unit === undefined || (unit.kind !== "user" && unit.kind !== "assistant")) return null;
  const texts = unit.blocks.filter((block) => block.type === "text");
  const own = texts.filter((block) => block.uuid === nativeId);
  return (own.length > 0 ? own : texts).map((block) => block.text).join("\n\n");
};

export const rowLook = (input: RowLookInput): RowLook => {
  const { baseUnits, preview, steps, unitKeys } = input;
  if (unitKeys.length === 0 || preview === null) return PLAIN;

  if (preview.failedAt !== null) {
    const index = stepIndexOfOp(steps, preview.failedAt.index);
    const failedStep = steps[index];
    return failedStep !== undefined && failedStep.unitKeys.some((key) => unitKeys.includes(key))
      ? {
          kind: "marker",
          badge: "Cannot apply",
          tone: "destructive",
          step: stepRef(steps, index),
          failure: preview.failedAt.message,
          previewText: null,
        }
      : PLAIN;
  }

  const removedThinking = input.nativeIds
    .map(thinkingRef)
    .filter(
      (ref): ref is ThinkingRef =>
        ref !== null &&
        findThinking(baseUnits, ref) !== undefined &&
        findThinking(preview.units, ref) === undefined,
    );
  if (removedThinking.length > 0 && removedThinking.length === input.nativeIds.length) {
    return {
      kind: "removed",
      badge: "Removed",
      label: "Thinking",
      excerpt: removedThinking.map((ref) => findThinking(baseUnits, ref)?.text ?? "").join(" "),
      movesAfter: null,
      step: newestStepFor(steps, unitKeys),
      restore: { kind: "thinking", blocks: removedThinking },
    };
  }

  const changes = unitChanges(preview.diff);
  const rowChanges = unitKeys.map((key) => changes.get(key) ?? null);
  if (rowChanges.every(isMovedAway)) {
    const movedIndex = rowChanges.findIndex((change) => change !== "removed");
    const movedKey = unitKeys[movedIndex];
    const newIndex = preview.units.findIndex((unit) => unit.key === movedKey);
    return {
      kind: "removed",
      badge: movedIndex < 0 ? "Removed" : "Moved",
      label: UNIT_KIND_LABEL[baseUnits.find((unit) => unit.key === unitKeys[0])?.kind ?? "system"],
      excerpt: unitKeys
        .map((key) => baseUnits.find((unit) => unit.key === key)?.excerpt ?? "")
        .join(" "),
      movesAfter: movedIndex < 0 ? null : (preview.units[newIndex - 1]?.excerpt ?? null),
      step: newestStepFor(steps, unitKeys),
      restore: { kind: "units", unitKeys },
    };
  }

  const change = rowChanges.find((item) => item !== null) ?? null;
  if (change === null && removedThinking.length === 0) return PLAIN;
  return {
    kind: "marker",
    badge: change === null ? "Edited" : CHANGE_WORD[change],
    tone: "primary",
    step: newestStepFor(steps, unitKeys),
    failure: null,
    previewText:
      unitKeys.length === 1 && change === "edited"
        ? previewTextOf(
            preview.units.find((unit) => unit.key === unitKeys[0]),
            input.nativeIds[0] ?? null,
          )
        : null,
  };
};

export const draftBadge = (
  change: DraftAnchor["change"],
  unitKey: string,
  changes: ReadonlyMap<string, UnitChange>,
): ChangeBadge | null => {
  if (change === "inserted") return "Inserted";
  if (change === "moved")
    return changes.get(unitKey) === "movedEdited" ? "Moved and edited" : "Moved here";
  const fileChange = changes.get(unitKey);
  return fileChange === undefined ? null : CHANGE_WORD[fileChange];
};

export const insertStep = (
  units: ReadonlyArray<ForkTranscriptUnitView>,
  unitKey: string,
  position: "above" | "below",
  role: "user" | "assistant",
  text: string,
): Omit<Step, "id"> => {
  const index = units.findIndex((unit) => unit.key === unitKey);
  const op = makeInsert(units, { role, text, index: position === "above" ? index : index + 1 });
  return {
    label: "Inserted message",
    unitKeys: [op.uuid, unitKey],
    items: [{ op, at: new Date().toISOString() }],
  };
};

const removesThinking = (op: Step["items"][number]["op"], refs: ReadonlyArray<ThinkingRef>) => {
  if (op.kind !== "removeThinking" || op.target === "all") return false;
  const { uuid, block } = op.target;
  return refs.some((ref) => ref.uuid === uuid && ref.block === block);
};

export const withoutThinkingRemoval = (
  steps: ReadonlyArray<Step>,
  refs: ReadonlyArray<ThinkingRef>,
): ReadonlyArray<Step> =>
  steps.flatMap((step) => {
    const items = step.items.filter((pending) => !removesThinking(pending.op, refs));
    if (items.length === step.items.length) return [step];
    return items.length === 0 ? [] : [{ ...step, items }];
  });
