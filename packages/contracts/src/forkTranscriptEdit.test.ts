import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "./auth.ts";
import { CLIENT_GUARDED_RPC_SCOPES, clientRpcRequiredScopes } from "./clientRpcPermissions.ts";
import {
  FORK_TRANSCRIPT_EDIT_RPCS,
  FORK_TRANSCRIPT_EDIT_WS_METHODS,
  ForkTranscriptEditError,
  ForkTranscriptOp,
  ForkTranscriptPreviewInput,
  ForkTranscriptSaveInput,
} from "./forkTranscriptEdit.ts";
import { OrchestrationV2TurnItemJson } from "./orchestrationV2.ts";
import { WsRpcGroup } from "./rpc.ts";

const decodeOp = Schema.decodeUnknownSync(ForkTranscriptOp);
const decodePreview = Schema.decodeUnknownSync(ForkTranscriptPreviewInput);
const decodeSave = Schema.decodeUnknownSync(ForkTranscriptSaveInput);
const decodeTurnItemJson = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);
const encodeTurnItemJson = Schema.encodeSync(OrchestrationV2TurnItemJson);

describe("ForkTranscriptOp", () => {
  it("accepts every op kind of the old editor", () => {
    const ops = [
      { kind: "editUserText", uuid: "u1", block: null, text: "hi" },
      { kind: "editAssistantText", uuid: "a1", block: 0, text: "ok" },
      { kind: "editSystemContent", uuid: "s1", content: "note" },
      { kind: "removeThinking", target: "all" },
      { kind: "removeThinking", target: { uuid: "a1", block: 1 } },
      { kind: "deleteUnit", unit: "a1" },
      { kind: "deleteUnits", units: ["a1", "u1"] },
      { kind: "moveUnit", unit: "a1", toIndex: 2 },
      {
        kind: "insertMessage",
        role: "assistant",
        text: "new",
        index: 1,
        uuid: "6f1f3c1e-0000-4000-8000-000000000000",
        timestamp: "2026-11-25T10:00:00.000Z",
        messageId: "msg_abc",
      },
      {
        kind: "insertMessage",
        role: "user",
        text: "follow up",
        index: 0,
        uuid: "6f1f3c1e-0000-4000-8000-000000000001",
        timestamp: "2026-11-25T10:01:00.000Z",
        messageId: null,
      },
    ];
    expect(ops.map((op) => decodeOp(op))).toEqual(ops);
  });

  it("rejects an unknown kind and a negative index", () => {
    expect(() => decodeOp({ kind: "rewrite", uuid: "u1" })).toThrow();
    expect(() => decodeOp({ kind: "moveUnit", unit: "a1", toIndex: -1 })).toThrow();
    expect(() =>
      decodeOp({ kind: "editAssistantText", uuid: "a1", block: -1, text: "x" }),
    ).toThrow();
  });

  it("limits a preview to 10,000 ops", () => {
    const op = { op: { kind: "deleteUnit", unit: "a1" }, at: "2026-11-25T10:00:00.000Z" };
    const input = (n: number) => ({
      threadId: "thread-1",
      baseKey: "k",
      ops: Array.from({ length: n }, () => op),
    });
    expect(decodePreview(input(10_000)).ops).toHaveLength(10_000);
    expect(() => decodePreview(input(10_001))).toThrow();
  });

  it("validates save input options and ops cap", () => {
    const op = { op: { kind: "deleteUnit", unit: "a1" }, at: "2026-11-25T10:00:00.000Z" };
    const valid = decodeSave({
      threadId: "thread-1",
      baseKey: "k",
      ops: [op],
      confirmStop: true,
      after: "continue",
    });
    expect(valid.after).toBe("continue");
    expect(() =>
      decodeSave({
        threadId: "thread-1",
        baseKey: "k",
        ops: [op],
        confirmStop: false,
        after: "restart",
      }),
    ).toThrow();
  });
});

describe("ForkTranscriptEditError and RPC wiring", () => {
  it("uses detail as the error message", () => {
    const error = new ForkTranscriptEditError({ code: "stale", detail: "Session file changed." });
    expect(error.message).toBe("Session file changed.");
  });

  it("registers all seven RPCs in WsRpcGroup", () => {
    expect(FORK_TRANSCRIPT_EDIT_RPCS).toHaveLength(7);
    const methods = Object.values(FORK_TRANSCRIPT_EDIT_WS_METHODS);
    expect(methods).toHaveLength(7);
    expect(methods.every((method) => WsRpcGroup.requests.has(method))).toBe(true);
  });

  it("assigns read and operate scopes in CLIENT_GUARDED_RPC_SCOPES", () => {
    const readMethods = [
      FORK_TRANSCRIPT_EDIT_WS_METHODS.load,
      FORK_TRANSCRIPT_EDIT_WS_METHODS.preview,
      FORK_TRANSCRIPT_EDIT_WS_METHODS.backups,
      FORK_TRANSCRIPT_EDIT_WS_METHODS.blockText,
    ];
    const operateMethods = [
      FORK_TRANSCRIPT_EDIT_WS_METHODS.save,
      FORK_TRANSCRIPT_EDIT_WS_METHODS.restore,
      FORK_TRANSCRIPT_EDIT_WS_METHODS.deleteBackup,
    ];
    expect(readMethods.map((method) => CLIENT_GUARDED_RPC_SCOPES[method])).toEqual(
      readMethods.map(() => AuthOrchestrationReadScope),
    );
    expect(operateMethods.map((method) => CLIENT_GUARDED_RPC_SCOPES[method])).toEqual(
      operateMethods.map(() => AuthOrchestrationOperateScope),
    );
    expect(clientRpcRequiredScopes(FORK_TRANSCRIPT_EDIT_WS_METHODS.load, undefined)).toEqual([
      AuthOrchestrationReadScope,
    ]);
    expect(clientRpcRequiredScopes(FORK_TRANSCRIPT_EDIT_WS_METHODS.save, undefined)).toEqual([
      AuthOrchestrationOperateScope,
    ]);
  });
});

describe("OrchestrationV2TurnItem forkTranscriptHidden", () => {
  const baseItem = {
    id: "item-1",
    type: "system_notice",
    threadId: "thread-1",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-11-25T10:00:00.000Z",
    message: "Hello",
  };

  it("omits forkTranscriptHidden when absent and round-trips true", () => {
    const shown = decodeTurnItemJson(baseItem);
    expect(shown.forkTranscriptHidden).toBeUndefined();
    expect("forkTranscriptHidden" in shown).toBe(false);

    const hidden = decodeTurnItemJson({ ...baseItem, forkTranscriptHidden: true });
    expect(hidden.forkTranscriptHidden).toBe(true);
    expect(encodeTurnItemJson(hidden)).toMatchObject({ forkTranscriptHidden: true });
  });

  it("rejects non-true values for forkTranscriptHidden", () => {
    expect(() => decodeTurnItemJson({ ...baseItem, forkTranscriptHidden: false })).toThrow();
  });
});
