import type { Block, Entry, Transcript } from "./types.ts";

export type UnitKind = "preamble" | "user" | "assistant" | "tool" | "system";

// entries lists every path entry of the unit in order, main only its message entries.
// side lists tool_result entries off the path whose tool_use is in main.
export type Unit = {
  key: string;
  kind: UnitKind;
  entries: string[];
  main: string[];
  side: string[];
  locked: boolean;
  meta: boolean;
  compactSummary: boolean;
};

// Follows next() from seed until it returns null. Stops after limit steps to survive cycles.
const unfold = <T>(
  seed: T | null,
  next: (value: T) => T | null,
  limit: number,
): { items: T[]; complete: boolean } => {
  const end = Array.from({ length: limit }).reduce<{ items: T[]; cur: T | null }>(
    (acc) => {
      if (acc.cur === null) return acc;
      acc.items.push(acc.cur);
      return { items: acc.items, cur: next(acc.cur) };
    },
    { items: [], cur: seed },
  );
  return { items: end.items, complete: end.cur === null };
};

export const entries = (t: Transcript): Entry[] =>
  t.lines.flatMap((l) => (l.entry ? [l.entry] : []));

export const byUuid = (t: Transcript): Map<string, Entry> =>
  new Map(entries(t).flatMap((e) => (typeof e.uuid === "string" ? [[e.uuid, e] as const] : [])));

export const activeLeaf = (t: Transcript): string | null =>
  entries(t).findLast((e) => e.type === "last-prompt" && typeof e.leafUuid === "string")
    ?.leafUuid ?? null;

const fallbackLeaf = (t: Transcript): string | null =>
  entries(t).findLast((e) => typeof e.uuid === "string")?.uuid ?? null;

export const walkToRoot = (
  map: Map<string, Entry>,
  leaf: string | null,
): { path: Entry[]; complete: boolean } => {
  const walk = unfold<Entry>(
    leaf === null ? null : (map.get(leaf) ?? null),
    (e) => (e.parentUuid ? (map.get(e.parentUuid) ?? null) : null),
    map.size + 1,
  );
  const last = walk.items.at(-1);
  return {
    path: walk.items.reverse(),
    complete: leaf !== null && last !== undefined && (last.parentUuid ?? null) === null,
  };
};

export const activePath = (t: Transcript): Entry[] =>
  walkToRoot(byUuid(t), activeLeaf(t) ?? fallbackLeaf(t)).path;

export const blocks = (e: Entry): Block[] =>
  Array.isArray(e.message?.content) ? e.message.content : [];

export const hasBlock = (e: Entry, type: string): boolean => blocks(e).some((b) => b.type === type);

const isToolUse = (e: Entry) => e.type === "assistant" && hasBlock(e, "tool_use");
const isToolResult = (e: Entry) => e.type === "user" && hasBlock(e, "tool_result");
const isMessage = (e: Entry) => e.type === "user" || e.type === "assistant" || e.type === "system";

const newUnit = (e: Entry, kind: UnitKind, uuid: string): Unit => ({
  key: uuid,
  kind,
  entries: [uuid],
  main: kind === "preamble" ? [] : [uuid],
  locked: kind === "preamble" || (e.type === "system" && e.subtype === "compact_boundary"),
  meta: e.isMeta === true,
  compactSummary: e.isCompactSummary === true,
  side: [],
});

const groupUnits = (path: Entry[]): Unit[] => {
  const map = new Map(
    path.flatMap((e) => (typeof e.uuid === "string" ? [[e.uuid, e] as const] : [])),
  );
  const lastMain = (u: Unit | undefined) => {
    const id = u?.main.at(-1);
    return id === undefined ? undefined : map.get(id);
  };
  return path.reduce<Unit[]>((units, e) => {
    const uuid = e.uuid as string;
    const last = units.at(-1);
    const join = (main: boolean) => {
      last?.entries.push(uuid);
      if (main) last?.main.push(uuid);
      return units;
    };
    const pushUnit = (kind: UnitKind) => {
      units.push(newUnit(e, kind, uuid));
      return units;
    };
    const lastEntry = lastMain(last);
    const sameMessage = lastEntry?.type === "assistant" && lastEntry.message?.id === e.message?.id;
    if (!isMessage(e)) return last ? join(false) : pushUnit("preamble");
    if (isToolUse(e)) {
      return last?.kind === "tool" && sameMessage && isToolUse(lastEntry)
        ? join(true)
        : pushUnit("tool");
    }
    if (isToolResult(e)) return last?.kind === "tool" ? join(true) : pushUnit("tool");
    if (e.type === "assistant") {
      return last?.kind === "assistant" && sameMessage ? join(true) : pushUnit("assistant");
    }
    return pushUnit(e.type === "user" ? "user" : "system");
  }, []);
};

const THINKING = new Set(["thinking", "redacted_thinking"]);

// A unit keeps its key when its thinking lines go, so the key skips lines that hold only thinking.
const stableKeys = (units: Unit[], path: Entry[]): Unit[] => {
  const map = new Map(
    path.flatMap((e) => (typeof e.uuid === "string" ? [[e.uuid, e] as const] : [])),
  );
  const thinkingOnly = (id: string) => {
    const b = blocks(map.get(id) ?? {});
    return b.length > 0 && b.every((x) => THINKING.has(x.type));
  };
  return units.map((u) => ({ ...u, key: u.main.find((id) => !thinkingOnly(id)) ?? u.key }));
};

const isResult = (e: Entry) =>
  e.type === "user" && typeof e.uuid === "string" && hasBlock(e, "tool_result");

// Adds the side-branch results of each tool unit, in file order.
const withSideResults = (t: Transcript, units: Unit[], path: Entry[]): Unit[] => {
  const onPath = new Set(path.map((e) => e.uuid));
  const owner = new Map(
    units.flatMap((u) => (u.kind === "tool" ? u.main.map((id) => [id, u] as const) : [])),
  );
  const side = entries(t).filter(
    (e) => isResult(e) && !onPath.has(e.uuid) && owner.has(e.parentUuid ?? ""),
  );
  return units.map((u) =>
    u.kind === "tool"
      ? {
          ...u,
          side: side
            .filter((e) => owner.get(e.parentUuid ?? "") === u)
            .map((e) => e.uuid as string),
        }
      : u,
  );
};

export const buildUnits = (t: Transcript): Unit[] => {
  const path = activePath(t);
  return withSideResults(t, stableKeys(groupUnits(path), path), path);
};
