import type { ForkTranscriptUnitView, ForkTranscriptViewBlock } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { blockKey, formStep, type FormValues } from "./formSteps.logic";

const block = (
  type: ForkTranscriptViewBlock["type"],
  index: number | null,
  text: string,
): ForkTranscriptViewBlock => ({
  uuid: "a1",
  index,
  type,
  text,
  truncated: false,
  editable: type === "text" || type === "system",
  removable: type === "thinking" || type === "redacted_thinking",
});

const unit = (
  kind: ForkTranscriptUnitView["kind"],
  blocks: ReadonlyArray<ForkTranscriptViewBlock>,
): ForkTranscriptUnitView => ({
  key: "a1",
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: "2026-11-25T10:00:00.000Z",
  blocks,
  entries: [],
  hidden: [],
  excerpt: "reply one",
});

const values = (
  texts: ReadonlyArray<readonly [string, string]>,
  removed: ReadonlyArray<string> = [],
): FormValues => ({ texts: new Map(texts), removedThinking: new Set(removed) });

const thinking = block("thinking", 0, "hidden thought");
const text = block("text", 1, "reply one");
const assistant = unit("assistant", [thinking, text]);

describe("formStep", () => {
  it("turns one changed assistant text into one editAssistantText step", () => {
    const step = formStep(assistant, values([[blockKey(text), "reply two"]]));
    expect(step?.label).toBe("Edited assistant message");
    expect(step?.unitKeys).toEqual(["a1"]);
    expect(step?.items.map((item) => item.op)).toEqual([
      { kind: "editAssistantText", uuid: "a1", block: 1, text: "reply two" },
    ]);
  });

  it("puts a changed text and a removed thinking block into one step with two ops", () => {
    const step = formStep(assistant, values([[blockKey(text), "reply two"]], [blockKey(thinking)]));
    expect(step?.label).toBe("Edited assistant message and removed thinking");
    expect(step?.items.map((item) => item.op.kind)).toEqual([
      "editAssistantText",
      "removeThinking",
    ]);
    expect(step?.items[1]?.op).toEqual({
      kind: "removeThinking",
      target: { uuid: "a1", block: 0 },
    });
  });

  it("gives null when no field changed", () => {
    expect(formStep(assistant, values([[blockKey(text), "reply one"]]))).toBeNull();
  });

  it("gives null when a text field is empty", () => {
    expect(formStep(assistant, values([[blockKey(text), "  "]]))).toBeNull();
  });

  it("uses editUserText with a null block for string content", () => {
    const userText = block("text", null, "hello");
    const step = formStep(unit("user", [userText]), values([[blockKey(userText), "hi"]]));
    expect(step?.label).toBe("Edited user message");
    expect(step?.items[0]?.op).toEqual({
      kind: "editUserText",
      uuid: "a1",
      block: null,
      text: "hi",
    });
  });

  it("uses editSystemContent for a system block", () => {
    const system = block("system", null, "note");
    const step = formStep(unit("system", [system]), values([[blockKey(system), "new note"]]));
    expect(step?.label).toBe("Edited system entry");
    expect(step?.items[0]?.op).toEqual({
      kind: "editSystemContent",
      uuid: "a1",
      content: "new note",
    });
  });
});
