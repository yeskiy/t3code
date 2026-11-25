import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  CommandId,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as GitWorkflow from "../../git/GitWorkflowService.ts";
import * as CheckpointRollbackService from "../../orchestration-v2/CheckpointRollbackService.ts";
import * as CheckpointService from "../../orchestration-v2/CheckpointService.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../../orchestration-v2/ProviderSessionManager.ts";
import { layerNoTaskFolders } from "../../orchestration-v2/ProviderTurnStartService.testkit.ts";
import * as RuntimePolicy from "../../orchestration-v2/RuntimePolicy.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ServerSettings from "../../serverSettings.ts";

it.effect("CheckpointRollbackService opts into the fallback and projects dropped prompts", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread:rollback-dropped-prompts");
    const projectId = ProjectId.make("project:rollback-dropped-prompts");
    const providerThreadId = ProviderThreadId.make("provider-thread:rollback-dropped-prompts");
    const providerSessionId = ProviderSessionId.make("provider-session:rollback-dropped-prompts");
    const providerInstanceId = ProviderInstanceId.make("claudeAgent");
    const checkpointId = CheckpointId.make("checkpoint:rollback-dropped-prompts");
    const scopeId = CheckpointScopeId.make("scope:rollback-dropped-prompts");
    const requestId = CommandId.make("command:rollback-dropped-prompts");
    const writtenEvents = yield* Ref.make<ReadonlyArray<OrchestrationV2DomainEvent>>([]);
    const receivedInputs = yield* Ref.make<
      ReadonlyArray<ProviderAdapter.ProviderAdapterV2RollbackThreadInput>
    >([]);

    const providerThread = {
      id: providerThreadId,
      driver: "claudeAgent",
      providerSessionId,
      providerInstanceId,
    };
    const thread = {
      id: threadId,
      projectId,
      worktreePath: null,
      branch: null,
      activeProviderThreadId: providerThreadId,
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "claude-sonnet-4-6" },
      deletedAt: null,
    };
    const projection = {
      thread,
      providerThread,
      providerSession: undefined,
      checkpoint: { id: checkpointId, scopeId, status: "missing", appRunOrdinal: 0 },
      scope: { id: scopeId, cwd: "/repo" },
      runsToRollback: [
        {
          id: RunId.make("run:rollback-dropped-prompts:1"),
          ordinal: 1,
          rootNodeId: null,
          providerInstanceId,
        },
      ],
      targetAttempt: undefined,
      rolledBackAttemptIds: [],
      staleCheckpoints: [],
      rootNodes: [],
      providerTurns: [],
    } as unknown as ProjectionStore.ProjectionCheckpointRollbackContext;

    const rollbackThread = vi.fn((input: ProviderAdapter.ProviderAdapterV2RollbackThreadInput) =>
      Ref.update(receivedInputs, (current) => [...current, input]).pipe(
        Effect.as({
          providerThread: input.providerThread,
          messages: [],
          runtimeRequests: [],
          forkDroppedPrompts: 2,
        }),
      ),
    );

    const testLayer = CheckpointRollbackService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          layerNoTaskFolders,
          ThreadCommandExecutor.layer,
          IdAllocator.layer,
          ServerSettings.layerTest(),
          Layer.mock(ServerConfig.ServerConfig)({ worktreesDir: "/synthetic-worktrees" } as never),
          Layer.mock(GitWorkflow.GitWorkflowService)({}),
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: () => Effect.succeedNone,
          }),
          Layer.mock(CheckpointService.CheckpointServiceV2)({
            discardRepositorySnapshots: () => Effect.void,
          }),
          Layer.mock(EventSink.EventSinkV2)({
            write: ({ events }) => Ref.set(writtenEvents, events).pipe(Effect.as([])),
          }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThread: () => Effect.succeed(thread as never),
            getCheckpointRollbackContext: () => Effect.succeed(projection),
          }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
            open: () => Effect.succeed({ rollbackThread } as never),
          }),
          Layer.mock(RuntimePolicy.RuntimePolicyV2)({
            resolve: () => Effect.succeed({ cwd: "/repo" } as never),
          }),
        ),
      ),
    );

    yield* Effect.gen(function* () {
      const service = yield* CheckpointRollbackService.CheckpointRollbackServiceV2;
      yield* service.execute({
        threadId,
        providerThreadId,
        checkpointId,
        scopeId,
        restoreFiles: false,
        requestId,
      });
    }).pipe(Effect.provide(testLayer));

    const inputs = yield* Ref.get(receivedInputs);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.forkEarlierCursorFallback, true);

    const events = yield* Ref.get(writtenEvents);
    const metadataEvent = events.find((event) => event.type === "thread.metadata-updated");
    assert.isDefined(metadataEvent);
    if (metadataEvent?.type !== "thread.metadata-updated") return;
    assert.deepEqual(metadataEvent.payload.forkRollbackDroppedPrompts, {
      requestId,
      count: 2,
    });
  }),
);
