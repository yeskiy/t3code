import type { UnitKind } from "./model.ts";
import type { Transcript } from "./types.ts";
import { unitViews, type UnitView } from "./view.ts";

export type DiffStatus = "added" | "removed" | "changed" | "moved" | "movedChanged";

export type DiffItem = {
  key: string;
  kind: UnitKind;
  status: DiffStatus;
  before: string | null;
  after: string | null;
};

export const unitText = (v: UnitView): string =>
  v.blocks
    .map((b) =>
      b.type === "text" || b.type === "system" ? b.text : `[${b.name ?? b.type}] ${b.text}`.trim(),
    )
    .join("\n");

// Indexes of a longest increasing subsequence: the units that kept their relative order.
const stableIndexes = (seq: number[]): Set<number> => {
  const { tails, prev } = seq.reduce<{ tails: number[]; prev: number[] }>(
    (acc, value, i) => {
      const pos = acc.tails.findIndex((t) => (seq[t] as number) >= value);
      const at = pos === -1 ? acc.tails.length : pos;
      acc.prev[i] = at > 0 ? (acc.tails[at - 1] as number) : -1;
      acc.tails[at] = i;
      return acc;
    },
    { tails: [], prev: [] },
  );
  const walk = (i: number, out: Set<number>): Set<number> =>
    i < 0 ? out : walk(prev[i] as number, out.add(i));
  return walk(tails.at(-1) ?? -1, new Set());
};

export const diffUnits = (before: Transcript, after: Transcript): DiffItem[] => {
  const old = new Map(unitViews(before, Number.POSITIVE_INFINITY).map((v, i) => [v.key, { v, i }]));
  const now = unitViews(after, Number.POSITIVE_INFINITY);
  const common = now.flatMap((v) => (old.has(v.key) ? [v.key] : []));
  const stable = stableIndexes(common.map((k) => old.get(k)?.i as number));
  const moved = new Set(common.filter((_, i) => !stable.has(i)));
  const present = new Set(now.map((v) => v.key));
  const changes = now.flatMap((v): DiffItem[] => {
    const prior = old.get(v.key)?.v;
    if (!prior) {
      return [{ key: v.key, kind: v.kind, status: "added", before: null, after: unitText(v) }];
    }
    const changed = unitText(prior) !== unitText(v);
    const status = moved.has(v.key)
      ? changed
        ? "movedChanged"
        : "moved"
      : changed
        ? "changed"
        : null;
    return status
      ? [{ key: v.key, kind: v.kind, status, before: unitText(prior), after: unitText(v) }]
      : [];
  });
  const removed = [...old.values()]
    .filter(({ v }) => !present.has(v.key))
    .map(({ v }): DiffItem => ({
      key: v.key,
      kind: v.kind,
      status: "removed",
      before: unitText(v),
      after: null,
    }));
  return [...changes, ...removed];
};
