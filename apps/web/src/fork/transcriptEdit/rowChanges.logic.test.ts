import type { ForkTranscriptDiffItem, ForkTranscriptUnitView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { draftAnchors, unitChanges } from "./rowChanges.logic";

const unit = (
  key: string,
  kind: ForkTranscriptUnitView["kind"] = "assistant",
): ForkTranscriptUnitView => ({
  key,
  kind,
  subtype: null,
  locked: false,
  meta: false,
  compactSummary: false,
  time: "2026-11-25T10:00:00.000Z",
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: key,
});

describe("rowChanges.logic", () => {
  it("maps every diff status to its UnitChange", () => {
    const diff: ReadonlyArray<ForkTranscriptDiffItem> = [
      { key: "u1", kind: "user", status: "changed", before: "a", after: "b" },
      { key: "a1", kind: "assistant", status: "moved", before: "x", after: "x" },
      { key: "a2", kind: "assistant", status: "movedChanged", before: "x", after: "y" },
      { key: "t1", kind: "tool", status: "removed", before: "cmd", after: null },
      { key: "ins1", kind: "user", status: "added", before: null, after: "new" },
    ];

    const changes = unitChanges(diff);
    expect(changes.get("u1")).toBe("edited");
    expect(changes.get("a1")).toBe("moved");
    expect(changes.get("a2")).toBe("movedEdited");
    expect(changes.get("t1")).toBe("removed");
    expect(changes.get("ins1")).toBe("inserted");
  });

  it("anchors an inserted unit after a3", () => {
    const preview = [unit("u1", "user"), unit("a3"), unit("ins1", "user")];
    const linked = new Set(["u1", "a3"]);
    const changes = unitChanges([
      { key: "ins1", kind: "user", status: "added", before: null, after: "hi" },
    ]);

    expect(draftAnchors({ preview, linkedUnitKeys: linked, changes })).toEqual([
      { afterUnitKey: "a3", unit: preview[2], change: "inserted" },
    ]);
  });

  it("anchors a moved unit after the linked unit before its new place", () => {
    const preview = [unit("u1", "user"), unit("a4"), unit("a1"), unit("a2")];
    const linked = new Set(["u1", "a1", "a2", "a4"]);
    const changes = unitChanges([
      { key: "a4", kind: "assistant", status: "moved", before: "4", after: "4" },
    ]);

    expect(draftAnchors({ preview, linkedUnitKeys: linked, changes })).toEqual([
      { afterUnitKey: "u1", unit: preview[1], change: "moved" },
    ]);
  });

  it("marks a base unit without a link as fileOnly", () => {
    const preview = [unit("sys0", "system"), unit("u1", "user"), unit("sys1", "system")];
    const linked = new Set(["u1"]);
    const changes = unitChanges([]);

    expect(draftAnchors({ preview, linkedUnitKeys: linked, changes })).toEqual([
      { afterUnitKey: null, unit: preview[0], change: "fileOnly" },
      { afterUnitKey: "u1", unit: preview[2], change: "fileOnly" },
    ]);
  });

  it("anchors an inserted unit after a moved unit to the nearest in-place linked unit", () => {
    const preview = [unit("u1", "user"), unit("a4"), unit("ins1", "user"), unit("a1")];
    const linked = new Set(["u1", "a1", "a4"]);
    const changes = unitChanges([
      { key: "a4", kind: "assistant", status: "movedChanged", before: "4", after: "4b" },
      { key: "ins1", kind: "user", status: "added", before: null, after: "new" },
    ]);

    expect(draftAnchors({ preview, linkedUnitKeys: linked, changes })).toEqual([
      { afterUnitKey: "u1", unit: preview[1], change: "moved" },
      { afterUnitKey: "u1", unit: preview[2], change: "inserted" },
    ]);
  });
});
