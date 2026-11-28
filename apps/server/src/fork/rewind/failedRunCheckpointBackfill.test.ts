import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as RuntimeLayer from "../../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import {
  backfillFailedRunCheckpoints,
  FAILED_RUN_CHECKPOINT_BACKFILL_MARKER,
} from "./failedRunCheckpointBackfill.ts";

const testLayer = Layer.mergeAll(
  RuntimeLayer.layerEventSink,
  ProjectionStore.layer,
  IdAllocator.layer,
).pipe(Layer.provideMerge(NodeCrypto.layer), Layer.provideMerge(SqlitePersistence.layerMemory));

const threadId = ThreadId.make("thread:backfill-failed-runs");
const projectId = ProjectId.make("project:backfill-failed-runs");
const scopeId = CheckpointScopeId.make("scope:backfill-failed-runs:root");
const providerThreadId = ProviderThreadId.make("provider-thread:backfill-failed-runs");
const providerInstanceId = ProviderInstanceId.make("claudeAgent");
const driver = ProviderDriverKind.make("claudeAgent");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "claude-sonnet-4-6",
} as const;

it.layer(testLayer)("backfillFailedRunCheckpoints", (it) => {
  it.effect(
    "backfills only failed runs without checkpoints, records the marker, and is idempotent",
    () =>
      Effect.gen(function* () {
        const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
        const sql = yield* SqlClient.SqlClient;
        const now = yield* DateTime.now;

        const seedRun = (input: {
          readonly ordinal: number;
          readonly status: "completed" | "interrupted" | "cancelled" | "failed";
          readonly existingCheckpointId?: CheckpointId;
        }) => {
          const runId = RunId.make(`run:backfill:${input.ordinal}`);
          const rootNodeId = NodeId.make(`node:backfill:${input.ordinal}`);
          const run: OrchestrationV2Run = {
            id: runId,
            threadId,
            ordinal: input.ordinal,
            providerInstanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make(`message:backfill:${input.ordinal}`),
            rootNodeId,
            activeAttemptId: null,
            status: input.status,
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: input.existingCheckpointId ?? null,
            contextHandoffId: null,
          };
          const node: OrchestrationV2ExecutionNode = {
            id: rootNodeId,
            threadId,
            runId,
            parentNodeId: null,
            rootNodeId,
            kind: "root_turn",
            status: input.status,
            countsForRun: true,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            runtimeRequestId: null,
            checkpointScopeId: scopeId,
            startedAt: now,
            completedAt: now,
          };
          const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
            {
              id: EventId.make(`event:backfill:run:${input.ordinal}`),
              type: "run.updated",
              threadId,
              runId,
              nodeId: rootNodeId,
              providerInstanceId,
              occurredAt: now,
              payload: run,
            },
            {
              id: EventId.make(`event:backfill:node:${input.ordinal}`),
              type: "node.updated",
              threadId,
              runId,
              nodeId: rootNodeId,
              providerInstanceId,
              occurredAt: now,
              payload: node,
            },
            ...(input.existingCheckpointId === undefined
              ? []
              : [
                  {
                    id: EventId.make(`event:backfill:checkpoint:${input.ordinal}`),
                    type: "checkpoint.captured" as const,
                    threadId,
                    runId,
                    nodeId: rootNodeId,
                    driver,
                    providerInstanceId,
                    occurredAt: now,
                    payload: {
                      id: input.existingCheckpointId,
                      threadId,
                      scopeId,
                      runId,
                      nodeId: rootNodeId,
                      parentCheckpointId: null,
                      ordinalWithinScope: input.ordinal,
                      appRunOrdinal: input.ordinal,
                      ref: CheckpointRef.make(`refs/t3/existing/${input.ordinal}`),
                      status: "ready",
                      files: [],
                      capturedAt: now,
                    } satisfies OrchestrationV2Checkpoint,
                  },
                ]),
          ];
          return { runId, rootNodeId, events };
        };

        const existingFailedCheckpointId = CheckpointId.make("checkpoint:backfill:existing-4");
        const completed = seedRun({ ordinal: 1, status: "completed" });
        const interrupted = seedRun({ ordinal: 2, status: "interrupted" });
        const cancelled = seedRun({ ordinal: 3, status: "cancelled" });
        const failedWithCheckpoint = seedRun({
          ordinal: 4,
          status: "failed",
          existingCheckpointId: existingFailedCheckpointId,
        });
        const failedMissingOne = seedRun({ ordinal: 5, status: "failed" });
        const failedMissingTwo = seedRun({ ordinal: 6, status: "failed" });

        const scope: OrchestrationV2CheckpointScope = {
          id: scopeId,
          threadId,
          runId: completed.runId,
          nodeId: completed.rootNodeId,
          parentScopeId: null,
          providerThreadId,
          kind: "root_run",
          ordinalWithinParent: 0,
          advancesAppRunCount: true,
          cwd: "/repo",
          createdAt: now,
        };

        const seedEvents: ReadonlyArray<OrchestrationV2DomainEvent> = [
          {
            id: EventId.make("event:backfill:thread"),
            type: "thread.created",
            threadId,
            occurredAt: now,
            payload: {
              createdBy: "user",
              creationSource: "web",
              id: threadId,
              projectId,
              title: "Backfill failed runs",
              providerInstanceId,
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              activeProviderThreadId: providerThreadId,
              lineage: {
                parentThreadId: null,
                relationshipToParent: null,
                rootThreadId: threadId,
              },
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              lastVisitedAt: null,
              deletedAt: null,
            },
          },
          {
            id: EventId.make("event:backfill:provider-thread"),
            type: "provider-thread.updated",
            threadId,
            nodeId: completed.rootNodeId,
            driver,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: providerThreadId,
              driver,
              providerInstanceId,
              providerSessionId: null,
              appThreadId: threadId,
              ownerNodeId: completed.rootNodeId,
              nativeThreadRef: null,
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: 1,
              lastRunOrdinal: 6,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            },
          },
          {
            id: EventId.make("event:backfill:scope"),
            type: "checkpoint-scope.created",
            threadId,
            runId: completed.runId,
            nodeId: completed.rootNodeId,
            occurredAt: now,
            payload: scope,
          },
          ...completed.events,
          ...interrupted.events,
          ...cancelled.events,
          ...failedWithCheckpoint.events,
          ...failedMissingOne.events,
          ...failedMissingTwo.events,
        ];
        yield* Effect.forEach(seedEvents, (event) => projectionStore.apply(event), {
          discard: true,
        });

        const firstRun = yield* backfillFailedRunCheckpoints();
        assert.deepEqual(firstRun, { alreadyApplied: false, filled: 2 });

        const markers = yield* sql<{ readonly name: string }>`
          SELECT name FROM fork_backfill_markers WHERE name = ${FAILED_RUN_CHECKPOINT_BACKFILL_MARKER}
        `;
        assert.equal(markers.length, 1);

        const projection = yield* projectionStore.getThreadProjection(threadId);
        const runById = new Map(projection.runs.map((run) => [run.id, run]));
        const checkpointByRunId = new Map(
          projection.checkpoints.flatMap((checkpoint) =>
            checkpoint.runId === null ? [] : [[checkpoint.runId, checkpoint] as const],
          ),
        );

        assert.isNull(runById.get(completed.runId)?.checkpointId);
        assert.isUndefined(checkpointByRunId.get(completed.runId));
        assert.isNull(runById.get(interrupted.runId)?.checkpointId);
        assert.isUndefined(checkpointByRunId.get(interrupted.runId));
        assert.isNull(runById.get(cancelled.runId)?.checkpointId);
        assert.isUndefined(checkpointByRunId.get(cancelled.runId));

        assert.equal(
          runById.get(failedWithCheckpoint.runId)?.checkpointId,
          existingFailedCheckpointId,
        );
        assert.equal(checkpointByRunId.get(failedWithCheckpoint.runId)?.status, "ready");

        const filledFive = checkpointByRunId.get(failedMissingOne.runId);
        assert.isDefined(filledFive);
        assert.equal(filledFive?.status, "missing");
        assert.equal(filledFive?.appRunOrdinal, 5);
        assert.equal(filledFive?.ordinalWithinScope, 5);
        assert.deepEqual(filledFive?.files, []);
        assert.equal(runById.get(failedMissingOne.runId)?.checkpointId, filledFive?.id);

        const filledSix = checkpointByRunId.get(failedMissingTwo.runId);
        assert.isDefined(filledSix);
        assert.equal(filledSix?.status, "missing");
        assert.equal(filledSix?.appRunOrdinal, 6);
        assert.equal(filledSix?.ordinalWithinScope, 6);
        assert.deepEqual(filledSix?.files, []);
        assert.equal(runById.get(failedMissingTwo.runId)?.checkpointId, filledSix?.id);

        const eventsBeforeRepeat = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM orchestration_v2_events
        `;
        const secondRun = yield* backfillFailedRunCheckpoints();
        assert.deepEqual(secondRun, { alreadyApplied: true, filled: 0 });

        yield* sql`DELETE FROM fork_backfill_markers WHERE name = ${FAILED_RUN_CHECKPOINT_BACKFILL_MARKER}`;
        const replayRun = yield* backfillFailedRunCheckpoints();
        assert.deepEqual(replayRun, { alreadyApplied: false, filled: 0 });

        const eventsAfterRepeat = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM orchestration_v2_events
        `;
        assert.equal(eventsAfterRepeat[0]?.count, eventsBeforeRepeat[0]?.count);
      }),
  );
});
