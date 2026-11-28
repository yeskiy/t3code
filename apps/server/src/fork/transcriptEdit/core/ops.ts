import { activePath, blocks, buildUnits, byUuid, entries, type Unit } from "./model.ts";
import type { Block, Entry, Line, Transcript } from "./types.ts";

export type ThinkingTarget = { uuid: string; block: number } | "all";

export type InsertOp = {
  kind: "insertMessage";
  role: "user" | "assistant";
  text: string;
  index: number;
  uuid: string;
  timestamp: string;
  messageId: string | null;
};

export type Op =
  | { kind: "editUserText"; uuid: string; block: number | null; text: string }
  | { kind: "editAssistantText"; uuid: string; block: number; text: string }
  | { kind: "editSystemContent"; uuid: string; content: string }
  | { kind: "removeThinking"; target: ThinkingTarget }
  | { kind: "deleteUnit"; unit: string }
  | { kind: "deleteUnits"; units: readonly string[] }
  | { kind: "moveUnit"; unit: string; toIndex: number }
  | InsertOp;

export type ApplyResult =
  | { ok: true; transcript: Transcript }
  | { ok: false; index: number; error: string };

// @effect-diagnostics-next-line extendsNativeError:off -- Pure synchronous core error caught by tryApply outside Effect.
export class OpError extends Error {}

const fail = (message: string): never => {
  throw new OpError(message);
};

const need = (t: Transcript, uuid: string): Entry =>
  byUuid(t).get(uuid) ?? fail(`No entry has uuid ${uuid}.`);

const isThinking = (b: Block | undefined) =>
  b?.type === "thinking" || b?.type === "redacted_thinking";

const withContent = (e: Entry, content: string | Block[]): Entry => ({
  ...e,
  message: { ...e.message, content },
});

const replaceEntry = (t: Transcript, uuid: string, entry: Entry): Transcript => ({
  ...t,
  lines: t.lines.map((l) => (l.entry?.uuid === uuid ? { entry } : l)),
});

const textBlock = (e: Entry, block: number): Block =>
  blocks(e)[block]?.type === "text"
    ? (blocks(e)[block] as Block)
    : fail("The target is not a text block.");

const editText = (
  t: Transcript,
  uuid: string,
  type: "user" | "assistant",
  block: number | null,
  text: string,
) => {
  const e = need(t, uuid);
  if (e.type !== type) fail(`The entry is not a ${type} entry.`);
  if (buildUnits(t).some((u) => u.locked && u.main.includes(uuid))) fail("The unit is locked.");
  if (block === null) {
    return typeof e.message?.content === "string"
      ? replaceEntry(t, uuid, withContent(e, text))
      : fail("The content is not a text block.");
  }
  textBlock(e, block);
  return replaceEntry(
    t,
    uuid,
    withContent(
      e,
      blocks(e).map((b, i) => (i === block ? { ...b, text } : b)),
    ),
  );
};

const editSystem = (t: Transcript, uuid: string, content: string) => {
  const e = need(t, uuid);
  if (e.type !== "system") fail("The entry is not a system entry.");
  if (e.subtype === "compact_boundary") fail("A compact boundary is locked.");
  if (typeof e.content !== "string") fail("The system entry has no text content.");
  return replaceEntry(t, uuid, { ...e, content });
};

const pendingLastPrompt = (l: Line | undefined) =>
  l?.raw === undefined && l?.entry?.type === "last-prompt";

// Points resume at leaf. A run of ops shares one appended last-prompt line.
const setLeaf = (t: Transcript, leaf: string): Transcript => {
  const entry: Entry = {
    type: "last-prompt",
    lastPrompt: entries(t).findLast((e) => e.type === "last-prompt")?.lastPrompt ?? "",
    leafUuid: leaf,
    ...(t.sessionId !== null ? { sessionId: t.sessionId } : {}),
  };
  const kept = pendingLastPrompt(t.lines.at(-1)) ? t.lines.slice(0, -1) : t.lines;
  return { ...t, lines: [...kept, { entry }] };
};

// Chains order as the active path and drops removed entries.
// Off-path children of a removed entry move to its nearest kept ancestor.
const relink = (t: Transcript, order: string[], removed: ReadonlySet<string>): Transcript => {
  const map = byUuid(t);
  const rootParent = activePath(t)[0]?.parentUuid ?? null;
  const parentOf = new Map(
    order.map((u, i) => [u, i === 0 ? rootParent : (order[i - 1] as string)]),
  );
  const kept = (p: string | null | undefined, limit = map.size): string | null =>
    p == null || limit <= 0 ? null : removed.has(p) ? kept(map.get(p)?.parentUuid, limit - 1) : p;
  const lines = t.lines.flatMap((l): Line[] => {
    const e = l.entry;
    if (!e?.uuid) return [l];
    if (removed.has(e.uuid)) return [];
    const parent = parentOf.has(e.uuid) ? parentOf.get(e.uuid) : kept(e.parentUuid);
    return parent === (e.parentUuid ?? null)
      ? [l]
      : [{ entry: { ...e, parentUuid: parent ?? null } }];
  });
  const leaf = order.at(-1) ?? fail("The active path is empty.");
  return setLeaf({ ...t, lines }, leaf);
};

const pathOrder = (t: Transcript) => activePath(t).map((e) => e.uuid as string);

const removeEntries = (t: Transcript, removed: ReadonlySet<string>) =>
  relink(
    t,
    pathOrder(t).filter((u) => !removed.has(u)),
    removed,
  );

const leadingLocked = (units: Unit[]) => {
  const first = units.findIndex((u) => !u.locked);
  return first === -1 ? units.length : first;
};

const findUnit = (units: Unit[], key: string): Unit => {
  const unit = units.find((u) => u.key === key) ?? fail(`No unit has key ${key}.`);
  return unit.locked ? fail("The unit is locked.") : unit;
};

// Deletes the units in one relink. A tool unit takes its side-branch results with it.
const deleteUnits = (t: Transcript, keys: readonly string[]) => {
  const units = buildUnits(t);
  if (keys.length === 0) fail("No unit is selected.");
  return removeEntries(
    t,
    new Set(keys.flatMap((key) => findUnit(units, key)).flatMap((u) => [...u.entries, ...u.side])),
  );
};

const moveUnit = (t: Transcript, key: string, toIndex: number) => {
  const units = buildUnits(t);
  const unit = findUnit(units, key);
  if (toIndex < leadingLocked(units)) fail("A unit cannot move in front of a locked unit.");
  if (toIndex >= units.length) fail("The target index is out of range.");
  const rest = units.filter((u) => u !== unit);
  return relink(
    t,
    [...rest.slice(0, toIndex), unit, ...rest.slice(toIndex)].flatMap((u) => u.entries),
    new Set(),
  );
};

const pickThinkingBlock = (
  t: Transcript,
  target: { uuid: string; block: number },
): [Entry, number[]] => {
  const entry = need(t, target.uuid);
  if (!isThinking(blocks(entry)[target.block])) fail("The target is not a thinking block.");
  return [entry, [target.block]];
};

const removeThinking = (t: Transcript, target: ThinkingTarget) => {
  const picks: [Entry, number[]][] =
    target === "all"
      ? activePath(t).flatMap((e) => {
          const idx = blocks(e).flatMap((b, i) => (isThinking(b) ? [i] : []));
          return idx.length ? [[e, idx] as [Entry, number[]]] : [];
        })
      : [pickThinkingBlock(t, target)];
  const whole = new Set(
    picks.filter(([e, idx]) => idx.length === blocks(e).length).map(([e]) => e.uuid as string),
  );
  const trimmed = picks
    .filter(([e]) => !whole.has(e.uuid as string))
    .reduce(
      (acc, [e, idx]) =>
        replaceEntry(
          acc,
          e.uuid as string,
          withContent(
            e,
            blocks(e).filter((_, i) => !idx.includes(i)),
          ),
        ),
      t,
    );
  return whole.size ? removeEntries(trimmed, whole) : trimmed;
};

const ENVELOPE = ["userType", "entrypoint", "cwd", "sessionId", "version", "gitBranch"] as const;

const isPlainUser = (e: Entry) =>
  e.type === "user" &&
  !e.isMeta &&
  !e.isCompactSummary &&
  !blocks(e).some((b) => b.type === "tool_result");

const isTextAssistant = (e: Entry) =>
  e.type === "assistant" && blocks(e).some((b) => b.type === "text");

const template = (
  t: Transcript,
  test: (e: Entry) => boolean,
  loose: (e: Entry) => boolean,
): Entry =>
  activePath(t).findLast(test) ??
  entries(t).findLast(test) ??
  entries(t).findLast(loose) ??
  fail("No entry exists to clone.");

const newEntry = (t: Transcript, op: InsertOp, parentUuid: string | null): Entry => {
  if (op.role === "assistant") {
    const tpl = template(t, isTextAssistant, (e) => e.type === "assistant");
    const { id: _oldId, ...restMessage } = tpl.message ?? {};
    return {
      ...tpl,
      parentUuid,
      uuid: op.uuid,
      timestamp: op.timestamp,
      message: {
        ...restMessage,
        ...(op.messageId !== null ? { id: op.messageId } : {}),
        content: [{ type: "text", text: op.text }],
        stop_reason: "end_turn",
      },
    };
  }
  const tpl = template(t, isPlainUser, (e) => typeof e.cwd === "string");
  return {
    parentUuid,
    isSidechain: tpl.isSidechain ?? false,
    type: "user",
    message: { role: "user", content: op.text },
    uuid: op.uuid,
    timestamp: op.timestamp,
    ...Object.fromEntries(ENVELOPE.filter((k) => tpl[k] !== undefined).map((k) => [k, tpl[k]])),
  };
};

const insertMessage = (t: Transcript, op: InsertOp) => {
  const units = buildUnits(t);
  if (op.index < leadingLocked(units)) fail("A message cannot go in front of a locked unit.");
  if (op.index > units.length) fail("The target index is out of range.");
  const before = units.slice(0, op.index).flatMap((u) => u.entries);
  const prev = before.at(-1) ?? null;
  const anchor = prev ?? units[op.index]?.entries[0] ?? fail("The active path is empty.");
  const at = t.lines.findIndex((l) => l.entry?.uuid === anchor) + (prev ? 1 : 0);
  const line: Line = { entry: newEntry(t, op, prev ?? activePath(t)[0]?.parentUuid ?? null) };
  const withLine = { ...t, lines: [...t.lines.slice(0, at), line, ...t.lines.slice(at)] };
  return relink(
    withLine,
    [...before, op.uuid, ...units.slice(op.index).flatMap((u) => u.entries)],
    new Set(),
  );
};

export const applyOp = (t: Transcript, op: Op): Transcript => {
  switch (op.kind) {
    case "editUserText":
      return editText(t, op.uuid, "user", op.block, op.text);
    case "editAssistantText":
      return editText(t, op.uuid, "assistant", op.block, op.text);
    case "editSystemContent":
      return editSystem(t, op.uuid, op.content);
    case "removeThinking":
      return removeThinking(t, op.target);
    case "deleteUnit":
      return deleteUnits(t, [op.unit]);
    case "deleteUnits":
      return deleteUnits(t, op.units);
    case "moveUnit":
      return moveUnit(t, op.unit, op.toIndex);
    case "insertMessage":
      return insertMessage(t, op);
  }
};

export const applyOps = (t: Transcript, ops: readonly Op[]): Transcript => ops.reduce(applyOp, t);

export const tryApply = (base: Transcript, items: readonly Op[]): ApplyResult =>
  items.reduce<ApplyResult>(
    (acc, op, index) => {
      if (!acc.ok) return acc;
      try {
        return { ok: true, transcript: applyOp(acc.transcript, op) };
      } catch (error) {
        return {
          ok: false,
          index,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { ok: true, transcript: base },
  );
