import type { OrchestrationV2Run } from "@t3tools/contracts";

const CAPTURED = new Set<OrchestrationV2Run["status"]>([
  "completed",
  "interrupted",
  "cancelled",
  "failed",
]);

// A failed run also pins a rewind point, so the next message keeps "Edit from here".
export const forkRunCapturesCheckpoint = (status: OrchestrationV2Run["status"]): boolean =>
  CAPTURED.has(status);
