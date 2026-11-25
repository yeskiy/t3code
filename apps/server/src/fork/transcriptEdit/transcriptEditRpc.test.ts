import { describe, expect, it } from "@effect/vitest";
import {
  FORK_TRANSCRIPT_EDIT_WS_METHODS,
  ForkTranscriptEditError,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ForkTranscriptEdit } from "./ForkTranscriptEdit.ts";
import { forkTranscriptEditRpcHandlers } from "./transcriptEditRpc.ts";

const threadId = ThreadId.make("thread-transcript-rpc");

describe("forkTranscriptEditRpcHandlers", () => {
  it.effect("maps all seven methods and delegates each call to the service", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly method: string; readonly input: unknown }> = [];
      const loadResult = {
        sessionId: "sess-1",
        baseKey: "key-1",
        units: [],
        links: [],
        validation: { errors: [], warnings: [] },
        live: { editable: true, reason: null, working: false },
      };
      const previewResult = {
        units: [],
        validation: { errors: [], warnings: [] },
        diff: [],
        failedAt: null,
      };
      const saveResult = {
        baseKey: "key-2",
        units: [],
        backup: "20261125T000000Z.jsonl",
        unmappedUnits: 0,
        inheritedUnits: 0,
        stoppedTurn: false,
      };
      const backupsResult = [
        {
          name: "20261125T000000Z.jsonl",
          source: "t3" as const,
          createdAt: "2026-11-25T00:00:00.000Z",
          size: 42,
        },
      ];
      const service: ForkTranscriptEdit["Service"] = {
        load: (input) =>
          Effect.sync(() => {
            calls.push({ method: "load", input });
            return loadResult;
          }),
        preview: (input) =>
          Effect.sync(() => {
            calls.push({ method: "preview", input });
            return previewResult;
          }),
        save: (input) =>
          Effect.sync(() => {
            calls.push({ method: "save", input });
            return saveResult;
          }),
        backups: (input) =>
          Effect.sync(() => {
            calls.push({ method: "backups", input });
            return backupsResult;
          }),
        restore: (input) =>
          Effect.sync(() => {
            calls.push({ method: "restore", input });
            return saveResult;
          }),
        deleteBackup: (input) =>
          Effect.sync(() => {
            calls.push({ method: "deleteBackup", input });
          }),
        blockText: (input) =>
          Effect.sync(() => {
            calls.push({ method: "blockText", input });
            return "full text";
          }),
      };

      const handlers = forkTranscriptEditRpcHandlers(service);
      expect(Object.keys(handlers).toSorted()).toEqual(
        Object.values(FORK_TRANSCRIPT_EDIT_WS_METHODS).toSorted(),
      );

      const loadInput = { threadId };
      const previewInput = { threadId, baseKey: "key-1", ops: [] };
      const saveInput = {
        threadId,
        baseKey: "key-1",
        ops: [],
        confirmStop: false,
        after: "idle" as const,
      };
      const backupsInput = { threadId };
      const restoreInput = {
        threadId,
        baseKey: "key-1",
        backup: "20261125T000000Z.jsonl",
        source: "t3" as const,
        confirmStop: false,
      };
      const deleteBackupInput = {
        threadId,
        backup: "20261125T000000Z.jsonl",
        source: "t3" as const,
      };
      const blockTextInput = {
        threadId,
        baseKey: "key-1",
        uuid: "u1",
        index: 0,
        part: "block" as const,
      };

      expect(yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.load](loadInput)).toEqual(loadResult);
      expect(yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.preview](previewInput)).toEqual(
        previewResult,
      );
      expect(yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.save](saveInput)).toEqual(saveResult);
      expect(yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.backups](backupsInput)).toEqual(
        backupsResult,
      );
      expect(yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.restore](restoreInput)).toEqual(
        saveResult,
      );
      expect(
        yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.deleteBackup](deleteBackupInput),
      ).toBeUndefined();
      expect(yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.blockText](blockTextInput)).toBe(
        "full text",
      );

      expect(calls).toEqual([
        { method: "load", input: loadInput },
        { method: "preview", input: previewInput },
        { method: "save", input: saveInput },
        { method: "backups", input: backupsInput },
        { method: "restore", input: restoreInput },
        { method: "deleteBackup", input: deleteBackupInput },
        { method: "blockText", input: blockTextInput },
      ]);
    }),
  );

  it.effect("propagates ForkTranscriptEditError from the service", () =>
    Effect.gen(function* () {
      const failure = new ForkTranscriptEditError({ code: "stale", detail: "changed" });
      const fail = () => Effect.fail(failure);
      const handlers = forkTranscriptEditRpcHandlers({
        load: fail,
        preview: fail,
        save: fail,
        backups: fail,
        restore: fail,
        deleteBackup: fail,
        blockText: fail,
      });

      const error = yield* handlers[FORK_TRANSCRIPT_EDIT_WS_METHODS.load]({ threadId }).pipe(
        Effect.flip,
      );
      expect(error).toEqual(failure);
    }),
  );
});
