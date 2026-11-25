import { describe, expect, it } from "@effect/vitest";

import { diffUnits, unitText } from "./diff.ts";
import { FIXTURE_LINES, FIXTURE_TEXT } from "./fixtures.ts";
import { lineText, parseJsonl, serializeJsonl } from "./jsonl.ts";
import { conversationKey } from "./key.ts";
import { activeLeaf, activePath, blocks, buildUnits, byUuid, entries, hasBlock } from "./model.ts";
import { applyOp, applyOps, OpError, tryApply } from "./ops.ts";
import { serializeCopy } from "./serialize.ts";
import { validate } from "./validate.ts";
import { fullBlockText, fullRawText, unitViews } from "./view.ts";

describe("transcript core", () => {
  it("round-trips untouched text byte for byte", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    expect(serializeJsonl(t0)).toBe(FIXTURE_TEXT);
    expect(entries(t0)).toHaveLength(FIXTURE_LINES.length);
    expect(activeLeaf(t0)).toBe("a4");
    expect(lineText(t0.lines[1]!)).toBe(FIXTURE_TEXT.split("\n")[1]);
  });

  it("groups units like the old editor", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    expect(buildUnits(t0).map((u) => [u.kind, u.key])).toEqual([
      ["user", "u1"],
      ["assistant", "a1"],
      ["tool", "a2"],
      ["assistant", "a3"],
      ["user", "u2"],
      ["assistant", "a4"],
    ]);
    const a2 = byUuid(t0).get("a2");
    expect(a2).toBeDefined();
    expect(blocks(a2!)).toHaveLength(1);
    expect(hasBlock(a2!, "tool_use")).toBe(true);
    expect(hasBlock(a2!, "text")).toBe(false);
  });

  it("edits user and assistant text and keeps other lines raw", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const t = applyOps(t0, [
      { kind: "editUserText", uuid: "u1", block: null, text: "ONE" },
      { kind: "editAssistantText", uuid: "a1", block: 0, text: "REPLY" },
    ]);
    const out = serializeJsonl(t).split("\n");
    expect(out[1]).toContain('"ONE"');
    expect(out[3]).toContain('"REPLY"');
    expect(out[2]).toBe(FIXTURE_TEXT.split("\n")[2]);
    expect(validate(t0, t).errors).toEqual([]);
  });

  it("deletes a tool unit with its result and relinks the chain", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const t = applyOps(t0, [{ kind: "deleteUnit", unit: "a2" }]);
    expect(activePath(t).map((e) => e.uuid)).toEqual(["u1", "a1t", "a1", "a3", "u2", "a4"]);
    expect(validate(t0, t).errors).toEqual([]);
  });

  it("deletes multiple units in one operation", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const t = applyOp(t0, { kind: "deleteUnits", units: ["a2", "a3"] });
    expect(buildUnits(t).map((u) => u.key)).toEqual(["u1", "a1", "u2", "a4"]);
    expect(validate(t0, t).errors).toEqual([]);
  });

  it("removes all thinking and drops a thinking-only entry", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const t = applyOps(t0, [{ kind: "removeThinking", target: "all" }]);
    expect(activePath(t).some((e) => e.uuid === "a1t")).toBe(false);
  });

  it("removes one thinking block by uuid and block index", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const t = applyOp(t0, { kind: "removeThinking", target: { uuid: "a1t", block: 0 } });
    expect(activePath(t).some((e) => e.uuid === "a1t")).toBe(false);
    expect(validate(t0, t).errors).toEqual([]);
  });

  it("moves a unit and inserts a message with a new leaf", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const moved = applyOps(t0, [{ kind: "moveUnit", unit: "a4", toIndex: 1 }]);
    expect(buildUnits(moved).map((u) => u.key)).toEqual(["u1", "a4", "a1", "a2", "a3", "u2"]);
    const inserted = applyOps(t0, [
      {
        kind: "insertMessage",
        role: "user",
        text: "mid",
        index: 4,
        uuid: "n1",
        timestamp: "2026-11-25T10:00:06.500Z",
        messageId: null,
      },
    ]);
    expect(buildUnits(inserted).map((u) => u.key)).toContain("n1");
    expect(serializeJsonl(inserted).trimEnd().split("\n").at(-1)).toContain('"leafUuid":"a4"');
  });

  it("inserts an assistant message and drops the template id when messageId is null", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const inserted = applyOp(t0, {
      kind: "insertMessage",
      role: "assistant",
      text: "added reply",
      index: 6,
      uuid: "n2",
      timestamp: "2026-11-25T10:00:09.000Z",
      messageId: null,
    });
    expect(byUuid(inserted).get("n2")?.message?.id).toBeUndefined();
    expect(activeLeaf(inserted)).toBe("n2");
    expect(validate(t0, inserted).errors).toEqual([]);
  });

  it("edits system content and refuses to edit a locked compact boundary", () => {
    const text = [
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        uuid: "c1",
        parentUuid: null,
        content: "boundary",
        sessionId: "s-1",
      }),
      JSON.stringify({
        type: "system",
        uuid: "s1",
        parentUuid: "c1",
        content: "old note",
        sessionId: "s-1",
      }),
      JSON.stringify({ type: "last-prompt", leafUuid: "s1", lastPrompt: "", sessionId: "s-1" }),
    ].join("\n");
    const t = parseJsonl(`${text}\n`);
    const edited = applyOp(t, { kind: "editSystemContent", uuid: "s1", content: "new note" });
    expect(byUuid(edited).get("s1")?.content).toBe("new note");
    expect(() => applyOp(t, { kind: "editSystemContent", uuid: "c1", content: "changed" })).toThrow(
      OpError,
    );
    expect(() => applyOp(t, { kind: "moveUnit", unit: "s1", toIndex: 0 })).toThrow(OpError);
  });

  it("refuses to edit a locked or missing target", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    expect(
      tryApply(t0, [{ kind: "editUserText", uuid: "nope", block: null, text: "x" }]),
    ).toMatchObject({ ok: false, index: 0 });
  });

  it("ignores exit-time lines in the conversation key", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const withCost = parseJsonl(`${FIXTURE_TEXT}{"type":"cost","total":1}\n`);
    expect(conversationKey(withCost)).toBe(conversationKey(t0));
  });

  it("cuts tool text in views and returns the full text on request", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const tool = unitViews(t0, 3).find((v) => v.kind === "tool");
    expect(tool?.blocks[0]).toMatchObject({ type: "tool_use", truncated: true });
    expect(tool?.blocks[0]?.text).toHaveLength(3);
    expect(fullBlockText(t0, "a2", 0)).toContain('"command": "ls"');
    expect(fullBlockText(t0, "r1", 0)).toBe("file.txt");
    expect(fullBlockText(t0, "u1", null)).toBe("one");
    expect(fullBlockText(t0, "missing", 0)).toBeNull();
  });

  it("lists the raw fields of each entry of a unit", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const assistant = unitViews(t0, 2_000).find((v) => v.key === "a1");
    expect(assistant?.entries.map((e) => [e.uuid, e.messageId])).toEqual([
      ["a1t", "msg_1"],
      ["a1", "msg_1"],
    ]);
    expect(assistant?.entries[1]).toMatchObject({
      parentUuid: "a1t",
      type: "assistant",
      rawTruncated: false,
    });
    expect(fullRawText(t0, "u1")).toContain('"content": "one"');
    expect(fullRawText(t0, "missing")).toBeNull();

    const truncatedAssistant = unitViews(t0, 10).find((v) => v.key === "a1");
    expect(truncatedAssistant?.entries[0]?.rawTruncated).toBe(true);
    expect(truncatedAssistant?.entries[0]?.raw).toHaveLength(10);
  });

  it("reports changed, moved, added, and removed units in the diff", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const edited = applyOps(t0, [{ kind: "editUserText", uuid: "u2", block: null, text: "TWO" }]);
    expect(diffUnits(t0, edited)).toEqual([
      expect.objectContaining({ key: "u2", status: "changed" }),
    ]);

    const movedAndEdited = applyOps(t0, [
      { kind: "moveUnit", unit: "a4", toIndex: 1 },
      { kind: "editAssistantText", uuid: "a4", block: 0, text: "MOVED" },
      { kind: "deleteUnit", unit: "a3" },
      {
        kind: "insertMessage",
        role: "user",
        text: "added",
        index: 1,
        uuid: "n3",
        timestamp: "2026-11-25T10:00:01.500Z",
        messageId: null,
      },
    ]);
    const diff = diffUnits(t0, movedAndEdited);
    expect(diff.map((d) => [d.key, d.status])).toEqual([
      ["n3", "added"],
      ["a4", "movedChanged"],
      ["a3", "removed"],
    ]);
    const u1View = unitViews(t0, 2_000).find((v) => v.key === "u1");
    expect(unitText(u1View!)).toBe("one");
  });

  it("validates broken chains, thinking changes, and tool pairing", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const modifiedThinking = parseJsonl(FIXTURE_TEXT.replace('"thinking":"hm"', '"thinking":"x"'));
    expect(validate(t0, modifiedThinking).errors.map((i) => i.code)).toContain("thinking-modified");

    const missingLeaf = parseJsonl(FIXTURE_TEXT.replace('"leafUuid":"a4"', '"leafUuid":"ghost"'));
    expect(validate(t0, missingLeaf).errors.map((i) => i.code)).toContain("missing-leaf");

    const orphanResult = parseJsonl(
      FIXTURE_TEXT.replace('"tool_use_id":"toolu_1"', '"tool_use_id":"other"'),
    );
    expect(validate(t0, orphanResult).errors.map((i) => i.code)).toContain("orphan-tool-result");
    expect(validate(t0, orphanResult).errors.map((i) => i.code)).toContain("unanswered-tool-use");
  });

  it("rewrites sessionId fields when serializing a copy", () => {
    const t0 = parseJsonl(FIXTURE_TEXT);
    const copied = serializeCopy(t0, "s-2");
    expect(copied).toContain('"sessionId":"s-2"');
    expect(copied).not.toContain('"sessionId":"s-1"');
    expect(copied.split("\n")[0]).toBe(FIXTURE_TEXT.split("\n")[0]);
  });
});
