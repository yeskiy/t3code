/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type {
  ForkTranscriptOp,
  ForkTranscriptUnitView,
  ForkTranscriptViewBlock,
} from "@t3tools/contracts";

import type { Step } from "./history.logic";

export interface FormValues {
  readonly texts: ReadonlyMap<string, string>;
  readonly removedThinking: ReadonlySet<string>;
}

export const blockKey = (block: ForkTranscriptViewBlock): string =>
  `${block.uuid}:${block.index ?? "-"}`;

const KIND_LABEL: Partial<Record<ForkTranscriptUnitView["kind"], string>> = {
  user: "Edited user message",
  assistant: "Edited assistant message",
  system: "Edited system entry",
};

const changedTexts = (unit: ForkTranscriptUnitView, values: FormValues) =>
  unit.blocks.flatMap((block) => {
    const next = values.texts.get(blockKey(block));
    return block.editable && next !== undefined && next !== block.text
      ? [{ block, text: next }]
      : [];
  });

export const hasEmptyText = (unit: ForkTranscriptUnitView, values: FormValues): boolean =>
  changedTexts(unit, values).some(({ text }) => text.trim().length === 0);

const textOp = (
  unit: ForkTranscriptUnitView,
  block: ForkTranscriptViewBlock,
  text: string,
): ForkTranscriptOp =>
  block.type === "system"
    ? { kind: "editSystemContent", uuid: block.uuid, content: text }
    : unit.kind === "assistant"
      ? { kind: "editAssistantText", uuid: block.uuid, block: block.index ?? 0, text }
      : { kind: "editUserText", uuid: block.uuid, block: block.index, text };

// Turns the values of one edit form into one step, or null when nothing applies.
export const formStep = (
  unit: ForkTranscriptUnitView,
  values: FormValues,
): Omit<Step, "id"> | null => {
  const texts = changedTexts(unit, values);
  if (texts.some(({ text }) => text.trim().length === 0)) return null;
  const removed = unit.blocks.filter(
    (block) =>
      block.removable && block.index !== null && values.removedThinking.has(blockKey(block)),
  );
  if (texts.length === 0 && removed.length === 0) return null;
  const at = new Date().toISOString();
  const ops: ReadonlyArray<ForkTranscriptOp> = [
    ...texts.map(({ block, text }) => textOp(unit, block, text)),
    ...removed.map((block): ForkTranscriptOp => ({
      kind: "removeThinking",
      target: { uuid: block.uuid, block: block.index ?? 0 },
    })),
  ];
  const editLabel = KIND_LABEL[unit.kind] ?? "Edited entry";
  return {
    label:
      texts.length === 0
        ? "Removed thinking"
        : removed.length === 0
          ? editLabel
          : `${editLabel} and removed thinking`,
    unitKeys: [unit.key],
    items: ops.map((op) => ({ op, at })),
  };
};
