import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  extractThreadHtmlArtifacts,
  FORK_ARTIFACTS_ENABLED_DEFAULT,
  FORK_ARTIFACTS_ENABLED_KEY,
  resolveSelectedArtifact,
} from "./artifacts.logic";

function dynamicToolRow(input: {
  readonly id: string;
  readonly toolName: string;
  readonly status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly output?: unknown;
}): ThreadStructureVisibleTurnItem {
  return {
    sourceThreadId: "thread-1",
    sourceItemId: input.id,
    item: {
      id: input.id,
      runId: "run-1",
      type: "dynamic_tool",
      status: input.status ?? "completed",
      toolName: input.toolName,
      ...(input.startedAt ? { startedAt: DateTime.makeUnsafe(input.startedAt) } : {}),
      updatedAt: DateTime.makeUnsafe(input.updatedAt),
      ...(input.output !== undefined ? { output: input.output } : {}),
    },
  } as unknown as ThreadStructureVisibleTurnItem;
}

describe("artifacts.logic", () => {
  it("defaults the fork setting to enabled with a fork-prefixed v1 key", () => {
    expect(FORK_ARTIFACTS_ENABLED_KEY).toBe("t3code:fork:artifacts-panel:v1");
    expect(FORK_ARTIFACTS_ENABLED_DEFAULT).toBe(true);
  });

  it("extracts completed html_render items newest first and ignores other items", () => {
    const rows: ThreadStructureVisibleTurnItem[] = [
      {
        sourceThreadId: "thread-1",
        sourceItemId: "msg-1",
        item: {
          id: "msg-1",
          type: "assistant_message",
          updatedAt: DateTime.makeUnsafe("2026-11-24T10:00:00.000Z"),
        },
      } as unknown as ThreadStructureVisibleTurnItem,
      dynamicToolRow({
        id: "preview-1",
        toolName: "mcp__t3-code__html_preview",
        startedAt: "2026-11-24T10:01:00.000Z",
        updatedAt: "2026-11-24T10:01:05.000Z",
        output: {
          htmlRender: { attachmentId: "att-preview-html", title: "Preview", height: 200 },
        },
      }),
      dynamicToolRow({
        id: "render-old",
        toolName: "mcp__t3-code__html_render",
        startedAt: "2026-11-24T10:02:00.000Z",
        updatedAt: "2026-11-24T10:02:02.000Z",
        output: {
          htmlRender: { attachmentId: "att-1-html", title: "Revenue chart", height: 320 },
        },
      }),
      dynamicToolRow({
        id: "render-running",
        toolName: "mcp__t3-code__html_render",
        status: "running",
        startedAt: "2026-11-24T10:03:00.000Z",
        updatedAt: "2026-11-24T10:03:01.000Z",
        output: {
          htmlRender: { attachmentId: "att-running-html", title: "Running", height: 240 },
        },
      }),
      dynamicToolRow({
        id: "render-error",
        toolName: "t3-code.html_render",
        startedAt: "2026-11-24T10:04:00.000Z",
        updatedAt: "2026-11-24T10:04:01.000Z",
        output: {
          isError: true,
          htmlRender: { attachmentId: "att-err-html", title: "Broken", height: 240 },
        },
      }),
      dynamicToolRow({
        id: "render-new",
        toolName: "execute",
        updatedAt: "2026-11-24T10:05:00.000Z",
        output: {
          htmlRender: { attachmentId: "att-2-html", title: "Architecture diagram", height: 480 },
        },
      }),
    ];

    const artifacts = extractThreadHtmlArtifacts(rows);

    expect(artifacts.map((artifact) => artifact.attachmentId)).toEqual([
      "att-2-html",
      "att-1-html",
    ]);
    expect(artifacts[0]).toEqual({
      id: "render-new",
      attachmentId: "att-2-html",
      title: "Architecture diagram",
      createdAt: "2026-11-24T10:05:00.000Z",
      htmlRender: { attachmentId: "att-2-html", title: "Architecture diagram", height: 480 },
    });
    expect(artifacts[1]).toEqual({
      id: "render-old",
      attachmentId: "att-1-html",
      title: "Revenue chart",
      createdAt: "2026-11-24T10:02:00.000Z",
      htmlRender: { attachmentId: "att-1-html", title: "Revenue chart", height: 320 },
    });
  });

  it("orders later turn items first when timestamps match and deduplicates by attachmentId", () => {
    const rows: ThreadStructureVisibleTurnItem[] = [
      dynamicToolRow({
        id: "render-a",
        toolName: "t3-code.html_render",
        startedAt: "2026-11-24T10:05:00.000Z",
        updatedAt: "2026-11-24T10:05:00.000Z",
        output: {
          htmlRender: { attachmentId: "att-a-html", title: "First", height: 200 },
        },
      }),
      dynamicToolRow({
        id: "render-b",
        toolName: "t3-code.html_render",
        startedAt: "2026-11-24T10:05:00.000Z",
        updatedAt: "2026-11-24T10:05:00.000Z",
        output: {
          htmlRender: { attachmentId: "att-b-html", title: "Second", height: 260 },
        },
      }),
      dynamicToolRow({
        id: "render-a-dup",
        toolName: "t3-code.html_render",
        startedAt: "2026-11-24T10:06:00.000Z",
        updatedAt: "2026-11-24T10:06:00.000Z",
        output: {
          htmlRender: { attachmentId: "att-a-html", title: "First updated", height: 300 },
        },
      }),
    ];

    const artifacts = extractThreadHtmlArtifacts(rows);

    expect(artifacts.map((artifact) => ({ id: artifact.id, title: artifact.title }))).toEqual([
      { id: "render-a-dup", title: "First updated" },
      { id: "render-b", title: "Second" },
    ]);
  });

  it("resolves a selected artifact only when it exists in the current thread list", () => {
    const artifacts = extractThreadHtmlArtifacts([
      dynamicToolRow({
        id: "render-1",
        toolName: "t3-code.html_render",
        updatedAt: "2026-11-24T10:00:00.000Z",
        output: {
          htmlRender: { attachmentId: "att-1-html", title: "One", height: 200 },
        },
      }),
    ]);

    expect(resolveSelectedArtifact(artifacts, null)).toBeNull();
    expect(resolveSelectedArtifact(artifacts, "missing-html")).toBeNull();
    expect(resolveSelectedArtifact(artifacts, "att-1-html")?.title).toBe("One");
  });
});
