import { describe, expect, it } from "vite-plus/test";

import { forkRunCapturesCheckpoint } from "./checkpointCapture.ts";

describe("forkRunCapturesCheckpoint", () => {
  it("captures checkpoints for completed, interrupted, cancelled, and failed runs", () => {
    expect(forkRunCapturesCheckpoint("completed")).toBe(true);
    expect(forkRunCapturesCheckpoint("interrupted")).toBe(true);
    expect(forkRunCapturesCheckpoint("cancelled")).toBe(true);
    expect(forkRunCapturesCheckpoint("failed")).toBe(true);
  });

  it("does not capture checkpoints for working or rolled-back runs", () => {
    expect(forkRunCapturesCheckpoint("preparing")).toBe(false);
    expect(forkRunCapturesCheckpoint("queued")).toBe(false);
    expect(forkRunCapturesCheckpoint("starting")).toBe(false);
    expect(forkRunCapturesCheckpoint("running")).toBe(false);
    expect(forkRunCapturesCheckpoint("waiting")).toBe(false);
    expect(forkRunCapturesCheckpoint("rolled_back")).toBe(false);
  });
});
