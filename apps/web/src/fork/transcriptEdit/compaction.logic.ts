type CutoffRow = {
  readonly position: number;
  readonly item: {
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly driver?: string | null;
    readonly forkTranscriptHidden?: true;
    readonly providerTurnId?: string | null;
  };
};

type Compactions = {
  readonly latest: number | null;
  readonly positions: ReadonlyMap<string, number>;
};

const cache = new WeakMap<ReadonlyArray<CutoffRow>, Compactions>();

const isClaudeCompaction = (row: CutoffRow): boolean =>
  row.item.type === "compaction" &&
  row.item.driver === "claudeAgent" &&
  row.item.status === "completed" &&
  row.item.forkTranscriptHidden !== true;

const compactionsOf = (rows: ReadonlyArray<CutoffRow>): Compactions => {
  const cached = cache.get(rows);
  if (cached !== undefined) return cached;
  const found = rows.filter(isClaudeCompaction);
  const value: Compactions = {
    latest: found.length === 0 ? null : Math.max(...found.map((row) => row.position)),
    positions: new Map(found.map((row) => [row.item.id, row.position] as const)),
  };
  cache.set(rows, value);
  return value;
};

// Rows below the returned position are before the last compaction. Before the first load
// (undefined id) the last completed Claude compaction decides, after it the server id decides.
export const compactionCutoff = (
  rows: ReadonlyArray<CutoffRow>,
  loadedCompactionId: string | null | undefined,
): number | null =>
  loadedCompactionId === undefined
    ? compactionsOf(rows).latest
    : loadedCompactionId === null
      ? null
      : (compactionsOf(rows).positions.get(loadedCompactionId) ?? null);

type SessionProjection = {
  readonly thread: { readonly activeProviderThreadId: string | null };
  readonly providerThreads: ReadonlyArray<{
    readonly id: string;
    readonly nativeMetadata?:
      | {
          readonly forkClaudeSessions?:
            | ReadonlyArray<{ readonly lastTurnOrdinal: number }>
            | undefined;
        }
      | null
      | undefined;
  }>;
  readonly providerTurns: ReadonlyArray<{
    readonly id: string;
    readonly providerThreadId: string;
    readonly ordinal: number;
  }>;
};

const turnCache = new WeakMap<SessionProjection, ReadonlySet<string>>();

// Provider turns of the active thread that its recorded earlier Claude sessions hold.
export const earlierSessionTurnIds = (projection: SessionProjection): ReadonlySet<string> => {
  const cached = turnCache.get(projection);
  if (cached !== undefined) return cached;
  const active = projection.thread.activeProviderThreadId;
  const spans =
    projection.providerThreads.find((thread) => thread.id === active)?.nativeMetadata
      ?.forkClaudeSessions ?? [];
  const last = Math.max(0, ...spans.map((span) => span.lastTurnOrdinal));
  const value = new Set(
    projection.providerTurns
      .filter((turn) => turn.providerThreadId === active && turn.ordinal <= last)
      .map((turn) => turn.id),
  );
  turnCache.set(projection, value);
  return value;
};

const positionCache = new WeakMap<ReadonlyArray<CutoffRow>, ReadonlyMap<string, number>>();

const positionsOf = (rows: ReadonlyArray<CutoffRow>): ReadonlyMap<string, number> => {
  const cached = positionCache.get(rows);
  if (cached !== undefined) return cached;
  const value = new Map(rows.map((row) => [row.item.id, row.position] as const));
  positionCache.set(rows, value);
  return value;
};

const lastEarlierCache = new WeakMap<
  ReadonlyArray<CutoffRow>,
  WeakMap<ReadonlySet<string>, number | null>
>();

const lastEarlierPosition = (
  rows: ReadonlyArray<CutoffRow>,
  turnIds: ReadonlySet<string>,
): number | null => {
  const byTurns = lastEarlierCache.get(rows) ?? new WeakMap<ReadonlySet<string>, number | null>();
  lastEarlierCache.set(rows, byTurns);
  const cached = byTurns.get(turnIds);
  if (cached !== undefined) return cached;
  const positions = rows
    .filter((row) => row.item.providerTurnId != null && turnIds.has(row.item.providerTurnId))
    .map((row) => row.position);
  const value = positions.length === 0 ? null : Math.max(...positions);
  byTurns.set(turnIds, value);
  return value;
};

// Rows up to the returned position belong to an earlier Claude session. Before the first load
// (undefined id) the session list decides, after it the server id decides.
export const earlierSessionCut = (
  rows: ReadonlyArray<CutoffRow>,
  turnIds: ReadonlySet<string>,
  loadedItemId: string | null | undefined,
): number | null =>
  loadedItemId === undefined
    ? lastEarlierPosition(rows, turnIds)
    : loadedItemId === null
      ? null
      : (positionsOf(rows).get(loadedItemId) ?? null);

export type RowCut = "before-compaction" | "earlier-session" | null;

export const rowCut = (
  position: number,
  cuts: { readonly compaction: number | null; readonly earlierSession: number | null },
): RowCut =>
  cuts.earlierSession !== null && position <= cuts.earlierSession
    ? "earlier-session"
    : cuts.compaction !== null && position < cuts.compaction
      ? "before-compaction"
      : null;
