import type { ForkTranscriptOp, ForkTranscriptUnitView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Step } from "./history.logic";
import { pendingUnits } from "./pendingUnits.logic";

const unit = (key: string, locked = false): ForkTranscriptUnitView => ({
  key,
  kind: "assistant",
  subtype: null,
  locked,
  meta: false,
  compactSummary: false,
  time: null,
  blocks: [],
  entries: [],
  hidden: [],
  excerpt: key,
});

const step = (id: string, ...ops: ReadonlyArray<ForkTranscriptOp>): Step => ({
  id,
  label: id,
  unitKeys: [],
  items: ops.map((op) => ({ op, at: "2026-11-26T00:00:00.000Z" })),
});

const BASE = ["pre", "a", "b", "c", "d"].map((key) => unit(key, key === "pre"));
const keys = (units: ReadonlyArray<ForkTranscriptUnitView> | null) =>
  units?.map((item) => item.key) ?? null;

describe("pendingUnits", () => {
  const remove = step("remove", { kind: "deleteUnits", units: ["c", "d"] });
  const move = step("move", { kind: "moveUnit", unit: "b", toIndex: 1 });

  it("applies steps the preview has not seen yet on top of the preview", () => {
    const session = {
      load: { units: BASE },
      preview: { units: BASE.filter((item) => item.key !== "c" && item.key !== "d") },
      previewSteps: [remove],
      history: { steps: [remove, move] },
    };
    expect(keys(pendingUnits(session))).toEqual(["pre", "b", "a"]);
  });

  it("replays every step from the loaded units after an undo", () => {
    const session = {
      load: { units: BASE },
      preview: { units: [] },
      previewSteps: [remove, move],
      history: { steps: [remove] },
    };
    expect(keys(pendingUnits(session))).toEqual(["pre", "a", "b"]);
  });

  it("waits for the preview when a step cannot apply locally", () => {
    const insert = step("insert", {
      kind: "insertMessage",
      role: "user",
      text: "hi",
      index: 1,
      uuid: "n1",
      timestamp: "2026-11-26T00:00:00.000Z",
      messageId: null,
    });
    const session = {
      load: { units: BASE },
      preview: null,
      previewSteps: [],
      history: { steps: [insert] },
    };
    expect(pendingUnits(session)).toBeNull();
  });

  it("refuses a move that the server would refuse", () => {
    const pastEnd = step("pastEnd", { kind: "moveUnit", unit: "a", toIndex: 5 });
    const beforeLocked = step("beforeLocked", { kind: "moveUnit", unit: "a", toIndex: 0 });
    const at = (item: Step) => ({
      load: { units: BASE },
      preview: null,
      previewSteps: [],
      history: { steps: [item] },
    });
    expect(pendingUnits(at(pastEnd))).toBeNull();
    expect(pendingUnits(at(beforeLocked))).toBeNull();
  });
});
