import {
  CheckpointId,
  CheckpointScopeId,
  ProviderDriverKind,
  ProviderThreadId,
  ThreadId,
  VcsProcessExitError,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { SHARED_WORKSPACE_RESTORE_MESSAGE } from "../../orchestration-v2/CheckpointRestoreSafety.ts";
import {
  CheckpointRollbackExecutionError,
  ROLLBACK_FAILED_MESSAGE,
} from "../../orchestration-v2/CheckpointRollbackService.ts";
import { CheckpointRestoreError } from "../../orchestration-v2/CheckpointService.ts";
import { GIT_INDEX_LOCKED_DETAIL } from "../../vcs/VcsProcess.ts";
import {
  ForkRollbackFailureClientMessage,
  forkRollbackFailureClientMessage,
  layerForkRollbackFailureClientMessage,
} from "./rollbackFailureMessage.ts";

const threadId = ThreadId.make("thread-rollback-reason");
const providerThreadId = ProviderThreadId.make("provider-thread-rollback-reason");
const checkpointId = CheckpointId.make("checkpoint-rollback-reason");
const scopeId = CheckpointScopeId.make("scope-rollback-reason");

const makeError = (
  reason: CheckpointRollbackExecutionError["reason"],
  cause?: unknown,
): CheckpointRollbackExecutionError =>
  new CheckpointRollbackExecutionError({
    reason,
    threadId,
    providerThreadId,
    checkpointId,
    ...(cause === undefined ? {} : { cause }),
  });

const makeRestoreError = (detail: string) =>
  makeError(
    "unexpected-failure",
    new CheckpointRestoreError({
      scopeId,
      checkpointId,
      cause: new VcsProcessExitError({
        operation: "GitVcsDriverCore.restoreCheckpoint",
        command: "git",
        cwd: "/private/repo",
        exitCode: 128,
        detail,
        failureKind: "command-failed",
      }),
    }),
  );

describe("forkRollbackFailureClientMessage", () => {
  it("keeps the upstream Git index lock message", () => {
    expect(forkRollbackFailureClientMessage(makeRestoreError(GIT_INDEX_LOCKED_DETAIL))).toBe(
      GIT_INDEX_LOCKED_DETAIL,
    );
  });

  it("keeps the general message for raw Git output", () => {
    expect(
      forkRollbackFailureClientMessage(
        makeRestoreError("error: could not clean /private/repo/secret.txt"),
      ),
    ).toBe(ROLLBACK_FAILED_MESSAGE);
  });

  it("explains rollback-target-invalid", () => {
    expect(forkRollbackFailureClientMessage(makeError("rollback-target-invalid"))).toBe(
      "The rewind point of this message is incomplete. Edit from an earlier message.",
    );
  });

  it("explains active-provider-changed", () => {
    expect(forkRollbackFailureClientMessage(makeError("active-provider-changed"))).toBe(
      "The thread uses another provider after this point. T3 cannot rewind to it.",
    );
  });

  it("explains provider-turn-unavailable", () => {
    expect(forkRollbackFailureClientMessage(makeError("provider-turn-unavailable"))).toBe(
      "The provider turn of this point is missing. T3 cannot rewind to it.",
    );
  });

  it("keeps SHARED_WORKSPACE_RESTORE_MESSAGE for shared-workspace", () => {
    expect(forkRollbackFailureClientMessage(makeError("shared-workspace"))).toBe(
      SHARED_WORKSPACE_RESTORE_MESSAGE,
    );
  });

  it("explains a missing Claude assistant cursor", () => {
    const adapterError = new ProviderAdapter.ProviderAdapterRollbackThreadError({
      driver: ProviderDriverKind.make("claudeAgent"),
      providerThreadId,
      cause:
        "Cannot roll back Claude thread: no SDK assistant message cursor was recorded for that turn.",
    });
    expect(forkRollbackFailureClientMessage(makeError("unexpected-failure", adapterError))).toBe(
      "This turn ended before Claude wrote a reply, and no earlier turn has a resume point. T3 cannot rewind to it.",
    );
  });

  it("formats other ProviderAdapterRollbackThreadError causes to one line capped at 200 characters", () => {
    const longFirstLine = "x".repeat(240);
    const adapterError = new ProviderAdapter.ProviderAdapterRollbackThreadError({
      driver: ProviderDriverKind.make("claudeAgent"),
      providerThreadId,
      cause: `${longFirstLine}\nsecond line details`,
    });
    expect(forkRollbackFailureClientMessage(makeError("unexpected-failure", adapterError))).toBe(
      `Claude could not rewind the session: ${"x".repeat(200)}`,
    );
  });

  it("reports the cause tag or unknown for other unexpected failures", () => {
    expect(
      forkRollbackFailureClientMessage(
        makeError("unexpected-failure", { _tag: "CustomProviderError" }),
      ),
    ).toBe(`${ROLLBACK_FAILED_MESSAGE} Reason: CustomProviderError`);
    expect(forkRollbackFailureClientMessage(makeError("unexpected-failure", "plain text"))).toBe(
      `${ROLLBACK_FAILED_MESSAGE} Reason: unknown`,
    );
  });

  effectIt.effect(
    "defaults ForkRollbackFailureClientMessage to upstream and activates with its layer",
    () =>
      Effect.gen(function* () {
        const error = makeError("rollback-target-invalid");
        const defaultMapper = yield* ForkRollbackFailureClientMessage;
        const forkMapper = yield* Effect.provide(
          ForkRollbackFailureClientMessage,
          layerForkRollbackFailureClientMessage,
        );
        expect(defaultMapper(error)).toBe(ROLLBACK_FAILED_MESSAGE);
        expect(forkMapper(error)).toBe(
          "The rewind point of this message is incomplete. Edit from an earlier message.",
        );
      }),
  );
});
