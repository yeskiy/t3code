import type { ForkTranscriptUnitView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeInsert } from "./insert.logic";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const unit = (key: string, time: string | null): ForkTranscriptUnitView => ({
  key,
  kind: "user",
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time,
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: "",
});

describe("insert.logic", () => {
  it("sets the timestamp to the middle of the neighbor unit times", () => {
    const units = [unit("u1", "2026-11-25T10:00:00.000Z"), unit("a1", "2026-11-25T10:00:10.000Z")];
    const op = makeInsert(units, { role: "assistant", text: "Added reply", index: 1 });

    expect(op.kind).toBe("insertMessage");
    expect(op.role).toBe("assistant");
    expect(op.text).toBe("Added reply");
    expect(op.index).toBe(1);
    expect(op.timestamp).toBe("2026-11-25T10:00:05.000Z");
    expect(op.uuid).toMatch(UUID_V4);
    expect(op.messageId).toMatch(/^msg_[A-Za-z0-9]{24}$/);
  });

  it("sets the timestamp at the end to the last time plus 1 ms", () => {
    const units = [unit("u1", "2026-11-25T10:00:00.000Z")];
    const op = makeInsert(units, { role: "user", text: "Follow up", index: 1 });

    expect(op.timestamp).toBe("2026-11-25T10:00:00.001Z");
    expect(op.messageId).toBeNull();
    expect(op.uuid).toMatch(UUID_V4);
  });

  it("sets the timestamp at index 0 to the first time minus 1 ms", () => {
    const units = [unit("u1", "2026-11-25T10:00:00.010Z")];
    const op = makeInsert(units, { role: "user", text: "Before all", index: 0 });

    expect(op.timestamp).toBe("2026-11-25T10:00:00.009Z");
    expect(op.messageId).toBeNull();
  });

  it("falls back to now when neither neighbor has a valid time", () => {
    const now = new Date("2026-11-25T12:34:56.789Z");
    const op = makeInsert([unit("u1", null)], { role: "assistant", text: "Hi", index: 1 }, now);

    expect(op.timestamp).toBe("2026-11-25T12:34:56.789Z");
    expect(op.messageId).toMatch(/^msg_[A-Za-z0-9]{24}$/);
  });
});
