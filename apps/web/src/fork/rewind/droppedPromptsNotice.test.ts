import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { rewindToMessage } from "../../components/chat/chatViewSend";
import { toastManager } from "../../components/ui/toast";
import { useComposerDraftStore } from "../../composerDraftStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import * as session from "../../state/session";
import { environmentThreadDetails } from "../../state/threads";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import {
  extractForkRollbackDroppedPrompts,
  formatForkRollbackDroppedPromptsMessage,
  notifyForkRollbackDroppedPrompts,
} from "./droppedPromptsNotice";

describe("droppedPromptsNotice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("formats singular and plural dropped prompt counts", () => {
    expect(formatForkRollbackDroppedPromptsMessage(1)).toBe(
      "Claude no longer sees 1 stopped prompt before this point.",
    );
    expect(formatForkRollbackDroppedPromptsMessage(3)).toBe(
      "Claude no longer sees 3 stopped prompts before this point.",
    );
  });

  it("extracts dropped prompt count only when the requestId matches", () => {
    const requestId = CommandId.make("rollback-req-1");
    const otherId = CommandId.make("rollback-req-2");
    expect(extractForkRollbackDroppedPrompts(undefined, requestId)).toBeNull();
    expect(
      extractForkRollbackDroppedPrompts({ forkRollbackDroppedPrompts: null }, requestId),
    ).toBeNull();
    expect(
      extractForkRollbackDroppedPrompts(
        { forkRollbackDroppedPrompts: { requestId: otherId, count: 2 } },
        requestId,
      ),
    ).toBeNull();
    expect(
      extractForkRollbackDroppedPrompts(
        { forkRollbackDroppedPrompts: { requestId, count: 2 } },
        requestId,
      ),
    ).toBe(2);
  });

  it("adds a toast only when the dropped prompt count is positive", () => {
    const add = vi.fn();
    notifyForkRollbackDroppedPrompts(null, add);
    notifyForkRollbackDroppedPrompts(0, add);
    expect(add).not.toHaveBeenCalled();

    notifyForkRollbackDroppedPrompts(2, add);
    expect(add).toHaveBeenCalledWith({
      type: "warning",
      title: "Claude no longer sees 2 stopped prompts before this point.",
    });
  });

  it("shows the dropped prompts toast when rewindToMessage completes after an earlier-cursor fallback", async () => {
    const threadRef = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-dropped-prompts"),
    };
    const base = makeThreadProjectionFixture();
    const providerThreadId = ProviderThreadId.make("provider-thread-dropped-prompts");
    const messageId = MessageId.make("message-2");
    const projection = {
      ...base,
      thread: { ...base.thread, id: threadRef.threadId, activeProviderThreadId: providerThreadId },
      providerThreads: [
        {
          id: providerThreadId,
          driver: "claudeAgent",
          providerInstanceId: base.thread.providerInstanceId,
          providerSessionId: ProviderSessionId.make("provider-session-dropped"),
          appThreadId: threadRef.threadId,
          ownerNodeId: null,
          nativeThreadRef: null,
          nativeConversationHeadRef: null,
          status: "idle",
          firstRunOrdinal: 1,
          lastRunOrdinal: 3,
          handoffIds: [],
          forkedFrom: null,
          createdAt: base.updatedAt,
          updatedAt: base.updatedAt,
        },
      ],
      runs: [1, 2, 3].map((ordinal) => ({
        id: RunId.make(`run-${ordinal}`),
        threadId: threadRef.threadId,
        ordinal,
        providerInstanceId: base.thread.providerInstanceId,
        modelSelection: base.thread.modelSelection,
        providerThreadId,
        userMessageId: MessageId.make(`message-${ordinal}`),
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        requestedAt: base.updatedAt,
        startedAt: base.updatedAt,
        completedAt: base.updatedAt,
        checkpointId: null,
        contextHandoffId: null,
      })),
      messages: [
        {
          id: messageId,
          threadId: threadRef.threadId,
          runId: RunId.make("run-2"),
          nodeId: null,
          role: "user",
          text: "Retry",
          attachments: [],
          streaming: false,
          createdAt: base.updatedAt,
          updatedAt: base.updatedAt,
        },
      ],
    } as unknown as ReturnType<typeof makeThreadProjectionFixture>;
    const state = Atom.make({ data: Option.some(projection) });
    vi.spyOn(environmentThreadDetails, "stateAtom").mockReturnValue(state as never);
    vi.spyOn(session, "readPreparedConnection").mockReturnValue({
      httpBaseUrl: "http://localhost",
    } as never);
    const toastSpy = vi.spyOn(toastManager, "add").mockReturnValue("toast-id" as never);
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });

    const result = await rewindToMessage({
      message: {
        id: messageId,
        role: "user",
        runId: RunId.make("run-2"),
        streaming: false,
        createdAt: "2026-11-25T10:00:02.000Z",
        updatedAt: "2026-11-25T10:00:02.000Z",
        text: "Retry",
      },
      environmentId: threadRef.environmentId,
      routeThreadRef: threadRef,
      threadId: threadRef.threadId,
      turnCount: 1,
      restoreFiles: false,
      checkpoint: undefined,
      draftTarget: threadRef,
      composerHasPendingAttachments: false,
      createAssetUrl: async () => {
        throw new Error("No attachment expected");
      },
      revertThreadCheckpoint: async ({ input }) => {
        appAtomRegistry.set(state, {
          data: Option.some({
            ...projection,
            thread: {
              ...projection.thread,
              forkRollbackDroppedPrompts: { requestId: input.commandId, count: 2 },
            },
            providerThreads: projection.providerThreads.map((providerThread) => ({
              ...providerThread,
              lastRunOrdinal: 1,
            })),
            runs: projection.runs.map((run) =>
              run.ordinal > 1 ? { ...run, status: "rolled_back" as const } : run,
            ),
          }),
        });
        return AsyncResult.success(undefined);
      },
    });

    expect(result).toEqual({ error: null, prompt: "Retry" });
    expect(toastSpy).toHaveBeenCalledWith({
      type: "warning",
      title: "Claude no longer sees 2 stopped prompts before this point.",
    });
  });
});
