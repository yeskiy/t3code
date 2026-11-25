import {
  CheckpointScopeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2DomainEvent,
  OrchestrationV2RunJson,
  ProviderDriverKind,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointService from "../../orchestration-v2/CheckpointService.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";

export const FAILED_RUN_CHECKPOINT_BACKFILL_MARKER = "failed-run-checkpoints-v1";

const decodeRunJson = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2RunJson));

interface FailedRunRow {
  readonly runId: string;
  readonly threadId: string;
  readonly ordinal: number;
  readonly providerThreadId: string | null;
  readonly runPayloadJson: string;
  readonly nodeScopeId: string | null;
  readonly providerDriver: string | null;
}

export interface FailedRunCheckpointBackfillResult {
  readonly alreadyApplied: boolean;
  readonly filled: number;
}

// Backfill conversation-only checkpoints once per database so failed runs support rewind.
export const backfillFailedRunCheckpoints = Effect.fn("fork.rewind.backfillFailedRunCheckpoints")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventSink = yield* EventSink.EventSinkV2;
    const ids = yield* IdAllocator.IdAllocatorV2;

    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_backfill_markers (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `;

    const existingMarker = yield* sql<{ readonly name: string }>`
      SELECT name FROM fork_backfill_markers WHERE name = ${FAILED_RUN_CHECKPOINT_BACKFILL_MARKER}
    `;
    if (existingMarker.length > 0) {
      return { alreadyApplied: true, filled: 0 };
    }

    const candidates = yield* sql<FailedRunRow>`
      SELECT
        r.run_id AS runId,
        r.thread_id AS threadId,
        r.ordinal AS ordinal,
        r.provider_thread_id AS providerThreadId,
        r.payload_json AS runPayloadJson,
        n.checkpoint_scope_id AS nodeScopeId,
        pt.provider AS providerDriver
      FROM orchestration_v2_projection_runs r
      LEFT JOIN orchestration_v2_projection_nodes n
        ON n.node_id = json_extract(r.payload_json, '$.rootNodeId')
      LEFT JOIN orchestration_v2_projection_provider_threads pt
        ON pt.provider_thread_id = r.provider_thread_id
      WHERE r.status = 'failed'
        AND json_extract(r.payload_json, '$.checkpointId') IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM orchestration_v2_projection_checkpoints c
          WHERE c.run_id = r.run_id
            AND c.status != 'stale'
        )
      ORDER BY r.thread_id, r.ordinal
    `;

    const filledFlags = yield* Effect.forEach(candidates, (row) =>
      Effect.gen(function* () {
        const run = yield* decodeRunJson(row.runPayloadJson).pipe(Effect.orElseSucceed(() => null));
        if (run === null || run.status !== "failed" || run.checkpointId !== null) return false;
        if (run.rootNodeId === null) return false;

        const rootScopeRows =
          row.nodeScopeId !== null
            ? yield* sql<{ readonly scopeId: string }>`
                SELECT scope_id AS scopeId
                FROM orchestration_v2_projection_checkpoint_scopes
                WHERE scope_id = ${row.nodeScopeId}
                  AND json_extract(payload_json, '$.repositoryPath') IS NULL
                LIMIT 1
              `
            : [];
        const fallbackScopeRows =
          rootScopeRows.length > 0
            ? rootScopeRows
            : yield* sql<{ readonly scopeId: string }>`
                SELECT scope_id AS scopeId
                FROM orchestration_v2_projection_checkpoint_scopes
                WHERE thread_id = ${run.threadId}
                  AND kind = 'root_run'
                  AND json_extract(payload_json, '$.repositoryPath') IS NULL
                ORDER BY
                  CASE WHEN provider_thread_id = ${run.providerThreadId} THEN 0 ELSE 1 END,
                  created_at DESC
                LIMIT 1
              `;
        const resolvedScopeId = fallbackScopeRows[0]?.scopeId;
        if (resolvedScopeId === undefined) return false;
        const scopeId = CheckpointScopeId.make(resolvedScopeId);

        const existingOrdinal = yield* sql<{ readonly checkpointId: string }>`
          SELECT checkpoint_id AS checkpointId
          FROM orchestration_v2_projection_checkpoints
          WHERE scope_id = ${scopeId}
            AND ordinal_within_scope = ${run.ordinal}
          LIMIT 1
        `;
        if (existingOrdinal.length > 0) return false;

        const checkpointId = yield* ids.allocate.checkpoint({
          checkpointScopeId: scopeId,
          name: String(run.ordinal),
        });
        const parentCheckpointId =
          run.ordinal > 0
            ? yield* ids.allocate.checkpoint({
                checkpointScopeId: scopeId,
                name: String(run.ordinal - 1),
              })
            : null;
        const ref = yield* CheckpointService.checkpointRefForScopeOrdinal({
          scopeId,
          ordinalWithinScope: run.ordinal,
        });
        const capturedAt = run.completedAt ?? run.requestedAt;
        const checkpoint: OrchestrationV2Checkpoint = {
          id: checkpointId,
          threadId: run.threadId,
          scopeId,
          runId: run.id,
          nodeId: run.rootNodeId,
          parentCheckpointId,
          ordinalWithinScope: run.ordinal,
          appRunOrdinal: run.ordinal,
          ref,
          status: "missing",
          files: [],
          capturedAt,
        };
        const driver =
          row.providerDriver === null ? undefined : ProviderDriverKind.make(row.providerDriver);
        const { delegatedCompletion: _delegatedCompletion, ...runWithoutDelegatedCompletion } = run;
        const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
          {
            id: yield* ids.allocate.event({ threadId: run.threadId }),
            type: "checkpoint.captured",
            threadId: run.threadId,
            runId: run.id,
            nodeId: run.rootNodeId,
            ...(driver === undefined ? {} : { driver }),
            providerInstanceId: run.providerInstanceId,
            occurredAt: capturedAt,
            payload: checkpoint,
          },
          {
            id: yield* ids.allocate.event({ threadId: run.threadId }),
            type: "run.updated",
            threadId: run.threadId,
            runId: run.id,
            nodeId: run.rootNodeId,
            providerInstanceId: run.providerInstanceId,
            occurredAt: capturedAt,
            payload: {
              ...runWithoutDelegatedCompletion,
              checkpointId: checkpoint.id,
            },
          },
        ];
        yield* eventSink.write({ events });
        return true;
      }),
    );

    const filled = filledFlags.filter(Boolean).length;
    const appliedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT OR IGNORE INTO fork_backfill_markers (name, applied_at)
      VALUES (${FAILED_RUN_CHECKPOINT_BACKFILL_MARKER}, ${appliedAt})
    `;
    yield* Effect.logInfo("Backfilled conversation-only checkpoints for failed runs", { filled });
    return { alreadyApplied: false, filled };
  },
);

export const backfillFailedRunCheckpointsOnStartup = backfillFailedRunCheckpoints().pipe(
  Effect.asVoid,
  Effect.catchCause((cause) =>
    Effect.logWarning("Failed to backfill conversation-only checkpoints for failed runs", {
      cause,
    }),
  ),
);
