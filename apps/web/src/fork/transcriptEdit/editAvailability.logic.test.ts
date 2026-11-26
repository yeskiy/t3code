import type { ForkTranscriptUnitView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { editBlock } from "./editAvailability.logic";

const unit = (locked: boolean): ForkTranscriptUnitView => ({
  key: "a1",
  kind: "assistant",
  subtype: null,
  locked,
  meta: false,
  compactSummary: false,
  time: null,
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: "",
});

const base = {
  driver: "claudeAgent",
  enabled: true,
  unitKey: "a1",
  unit: unit(false),
  loaded: true,
  beforeCompaction: false,
} as const;

describe("editBlock", () => {
  it("gives not-claude for a Codex driver", () => {
    expect(editBlock({ ...base, driver: "codex" })).toBe("not-claude");
  });

  it("gives setting-off when the setting is off", () => {
    expect(editBlock({ ...base, enabled: false })).toBe("setting-off");
  });

  it("gives not-linked for a loaded session without a link", () => {
    expect(editBlock({ ...base, unitKey: null, unit: undefined })).toBe("not-linked");
  });

  it("gives null before the first load, also without a link", () => {
    expect(editBlock({ ...base, unitKey: null, unit: undefined, loaded: false })).toBeNull();
  });

  it("gives locked for a locked unit", () => {
    expect(editBlock({ ...base, unit: unit(true) })).toBe("locked");
  });

  it("gives null for a linked Claude unit", () => {
    expect(editBlock(base)).toBeNull();
  });

  it("gives before-compaction for an unlinked item before the last compaction", () => {
    const before = { ...base, unitKey: null, unit: undefined, beforeCompaction: true };
    expect(editBlock(before)).toBe("before-compaction");
    expect(editBlock({ ...before, loaded: false })).toBe("before-compaction");
  });

  it("lets a linked unit win over the compaction mark", () => {
    expect(editBlock({ ...base, beforeCompaction: true })).toBeNull();
    expect(editBlock({ ...base, unit: unit(true), beforeCompaction: true })).toBe("locked");
  });

  it("gives not-claude before before-compaction", () => {
    expect(editBlock({ ...base, driver: "codex", beforeCompaction: true })).toBe("not-claude");
  });

  it("gives null for an unknown driver, so the load decides", () => {
    expect(editBlock({ ...base, driver: null })).toBeNull();
  });
});
