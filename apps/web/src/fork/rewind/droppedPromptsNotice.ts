/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { CommandId, OrchestrationV2AppThread, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { toastManager } from "../../components/ui/toast";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentThreadDetails } from "../../state/threads";

export function formatForkRollbackDroppedPromptsMessage(count: number): string {
  return count === 1
    ? "Claude no longer sees 1 stopped prompt before this point."
    : `Claude no longer sees ${count} stopped prompts before this point.`;
}

export function extractForkRollbackDroppedPrompts(
  thread: Pick<OrchestrationV2AppThread, "forkRollbackDroppedPrompts"> | undefined,
  requestId: CommandId,
): number | null {
  const dropped = thread?.forkRollbackDroppedPrompts;
  if (dropped == null || dropped.requestId !== requestId || dropped.count <= 0) return null;
  return dropped.count;
}

export function readForkRollbackDroppedPrompts(
  threadRef: ScopedThreadRef,
  requestId: CommandId,
): number | null {
  const projection = Option.getOrUndefined(
    appAtomRegistry.get(environmentThreadDetails.stateAtom(threadRef)).data,
  );
  return extractForkRollbackDroppedPrompts(projection?.thread, requestId);
}

export function notifyForkRollbackDroppedPrompts(
  count: number | null,
  addToast: (input: { readonly type: "warning"; readonly title: string }) => unknown = (input) =>
    toastManager.add(input),
): void {
  if (count === null || count <= 0) return;
  addToast({
    type: "warning",
    title: formatForkRollbackDroppedPromptsMessage(count),
  });
}
