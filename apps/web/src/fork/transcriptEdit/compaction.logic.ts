type CutoffRow = {
  readonly position: number;
  readonly item: {
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly driver?: string | null;
    readonly forkTranscriptHidden?: true;
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
