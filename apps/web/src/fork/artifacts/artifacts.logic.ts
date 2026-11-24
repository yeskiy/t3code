import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";
import { isCompleteTurnItemRow } from "@t3tools/client-runtime/state/threads";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

export const FORK_ARTIFACTS_ENABLED_KEY = "t3code:fork:artifacts-panel:v1";
export const ForkArtifactsEnabled = Schema.Boolean;
export const FORK_ARTIFACTS_ENABLED_DEFAULT = true;

export interface ThreadHtmlArtifact {
  readonly id: string;
  readonly attachmentId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly htmlRender: HtmlRenderReference;
}

export function extractThreadHtmlArtifacts(
  visibleTurnItems: ReadonlyArray<ThreadStructureVisibleTurnItem>,
): ReadonlyArray<ThreadHtmlArtifact> {
  const byAttachmentId = new Map<
    string,
    { readonly artifact: ThreadHtmlArtifact; readonly order: number; readonly timestampMs: number }
  >();

  visibleTurnItems.forEach((row, order) => {
    if (!isCompleteTurnItemRow(row)) return;
    const { item } = row;
    if (item.type !== "dynamic_tool" || item.status !== "completed") return;
    const htmlRender = htmlRenderFromToolItem(item);
    if (htmlRender === undefined) return;
    const createdAt = DateTime.formatIso(item.startedAt ?? item.updatedAt);
    const parsedTime = Date.parse(createdAt);
    byAttachmentId.set(htmlRender.attachmentId, {
      artifact: {
        id: item.id,
        attachmentId: htmlRender.attachmentId,
        title: htmlRender.title,
        createdAt,
        htmlRender,
      },
      order,
      timestampMs: Number.isFinite(parsedTime) ? parsedTime : Number.NEGATIVE_INFINITY,
    });
  });

  return [...byAttachmentId.values()]
    .toSorted((left, right) => right.timestampMs - left.timestampMs || right.order - left.order)
    .map((entry) => entry.artifact);
}

export function resolveSelectedArtifact(
  artifacts: ReadonlyArray<ThreadHtmlArtifact>,
  selectedAttachmentId: string | null,
): ThreadHtmlArtifact | null {
  if (selectedAttachmentId === null) return null;
  return artifacts.find((artifact) => artifact.attachmentId === selectedAttachmentId) ?? null;
}
