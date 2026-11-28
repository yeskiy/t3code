import { blocks, buildUnits, byUuid, type Unit, type UnitKind } from "./model.ts";
import type { Block, Entry, Transcript } from "./types.ts";

export type BlockType =
  | "text"
  | "thinking"
  | "redacted_thinking"
  | "tool_use"
  | "tool_result"
  | "system"
  | "image"
  | "other";

export type ViewBlock = {
  uuid: string;
  index: number | null;
  type: BlockType;
  text: string;
  truncated: boolean;
  editable: boolean;
  removable: boolean;
  name?: string;
  isError?: boolean;
};

export type EntryView = {
  uuid: string;
  parentUuid: string | null;
  type: string;
  timestamp: string | null;
  messageId: string | null;
  model: string | null;
  raw: string;
  rawTruncated: boolean;
};

export type HiddenEntry = { uuid: string; type: string; detail: string };

export type UnitView = {
  key: string;
  kind: UnitKind;
  subtype: string | null;
  locked: boolean;
  meta: boolean;
  compactSummary: boolean;
  handoff?: true;
  time: string | null;
  blocks: ViewBlock[];
  entries: EntryView[];
  hidden: HiddenEntry[];
  excerpt: string;
};

const EXCERPT = 120;

const excerptOf = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 3)}...` : flat;
};

const cutText = (text: string, limit: number): { text: string; truncated: boolean } =>
  text.length > limit
    ? { text: text.slice(0, limit), truncated: true }
    : { text, truncated: false };

const resultText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((c: Block) =>
            c.type === "text" && typeof c.text === "string" ? c.text : `[${c.type}]`,
          )
          .join("\n")
      : "";

const blockView = (
  uuid: string,
  kind: UnitKind,
  locked: boolean,
  b: Block,
  index: number,
  toolTextLimit: number,
): ViewBlock => {
  const base = { uuid, index, editable: false, removable: false, truncated: false };
  switch (b.type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: String(b.text ?? ""),
        editable: !locked && (kind === "user" || kind === "assistant"),
      };
    case "thinking":
      return { ...base, type: "thinking", text: String(b.thinking ?? ""), removable: true };
    case "redacted_thinking":
      return { ...base, type: "redacted_thinking", text: "", removable: true };
    case "tool_use":
      return {
        ...base,
        type: "tool_use",
        ...cutText(JSON.stringify(b.input ?? {}, null, 2), toolTextLimit),
        name: String(b.name ?? ""),
      };
    case "tool_result":
      return {
        ...base,
        type: "tool_result",
        ...cutText(resultText(b.content), toolTextLimit),
        isError: b.is_error === true,
      };
    case "image":
      return { ...base, type: "image", text: "" };
    default:
      return { ...base, type: "other", text: "", name: b.type };
  }
};

const entryBlocks = (
  e: Entry,
  kind: UnitKind,
  locked: boolean,
  toolTextLimit: number,
): ViewBlock[] => {
  const uuid = e.uuid as string;
  if (e.type === "system") {
    return [
      {
        uuid,
        index: null,
        type: "system",
        text: typeof e.content === "string" ? e.content : "",
        truncated: false,
        editable: typeof e.content === "string" && !locked,
        removable: false,
      },
    ];
  }
  const content = e.message?.content;
  if (typeof content === "string") {
    return [
      {
        uuid,
        index: null,
        type: "text",
        text: content,
        truncated: false,
        editable: !locked,
        removable: false,
      },
    ];
  }
  return blocks(e).map((b, i) => blockView(uuid, kind, locked, b, i, toolTextLimit));
};

const entryView = (e: Entry, toolTextLimit: number): EntryView => {
  const raw = JSON.stringify(e, null, 2);
  const rawTruncated = raw.length > toolTextLimit;
  return {
    uuid: e.uuid as string,
    parentUuid: typeof e.parentUuid === "string" ? e.parentUuid : null,
    type: String(e.type ?? ""),
    timestamp: typeof e.timestamp === "string" ? e.timestamp : null,
    messageId: typeof e.message?.id === "string" ? e.message.id : null,
    model: typeof e.message?.model === "string" ? e.message.model : null,
    raw: rawTruncated ? raw.slice(0, toolTextLimit) : raw,
    rawTruncated,
  };
};

const hiddenEntry = (e: Entry): HiddenEntry => {
  const attachment = e.attachment as { type?: unknown } | undefined;
  return {
    uuid: e.uuid as string,
    type: String(e.type ?? ""),
    detail: String(attachment?.type ?? e.subtype ?? ""),
  };
};

const viewOf = (
  map: Map<string, Entry>,
  fileOrder: Map<string, number>,
  u: Unit,
  toolTextLimit: number,
): UnitView => {
  const main = [...u.main, ...u.side].flatMap((id): Entry[] =>
    map.has(id) ? [map.get(id) as Entry] : [],
  );
  const first = main[0] ?? map.get(u.entries[0] ?? "");
  const bs = main.flatMap((e) => entryBlocks(e, u.kind, u.locked, toolTextLimit));
  const textual =
    bs.find((b) => b.type === "text" || b.type === "system") ?? bs.find((b) => b.text);
  const unitEntryIds = u.kind === "preamble" ? u.entries : [...u.main, ...u.side];
  const unitEntries = unitEntryIds
    .flatMap((id): Entry[] => (map.has(id) ? [map.get(id) as Entry] : []))
    .sort((a, b) => (fileOrder.get(a.uuid ?? "") ?? 0) - (fileOrder.get(b.uuid ?? "") ?? 0))
    .map((e) => entryView(e, toolTextLimit));
  return {
    key: u.key,
    kind: u.kind,
    subtype: typeof first?.subtype === "string" ? first.subtype : null,
    locked: u.locked,
    meta: u.meta,
    compactSummary: u.compactSummary,
    ...(u.handoff ? { handoff: true as const } : {}),
    time: typeof first?.timestamp === "string" ? first.timestamp : null,
    blocks: bs,
    entries: unitEntries,
    hidden: u.entries
      .filter((id) => !u.main.includes(id))
      .flatMap((id) => (map.has(id) ? [hiddenEntry(map.get(id) as Entry)] : [])),
    excerpt: excerptOf(textual?.name && !textual.text ? textual.name : (textual?.text ?? "")),
  };
};

export const unitViews = (t: Transcript, toolTextLimit: number): UnitView[] => {
  const map = byUuid(t);
  const fileOrder = new Map(
    t.lines.flatMap((line, index) =>
      typeof line.entry?.uuid === "string" ? [[line.entry.uuid, index] as const] : [],
    ),
  );
  return buildUnits(t).map((u) => viewOf(map, fileOrder, u, toolTextLimit));
};

// Returns the full text of one block when unitViews cut a tool block.
export const fullBlockText = (t: Transcript, uuid: string, index: number | null): string | null => {
  const e = byUuid(t).get(uuid);
  if (!e) return null;
  const b = index === null ? undefined : blocks(e)[index];
  if (index === null) {
    return typeof e.message?.content === "string"
      ? e.message.content
      : typeof e.content === "string"
        ? e.content
        : null;
  }
  if (!b) return null;
  return b.type === "tool_use"
    ? JSON.stringify(b.input ?? {}, null, 2)
    : b.type === "tool_result"
      ? resultText(b.content)
      : typeof b.text === "string"
        ? b.text
        : null;
};

// Returns the full pretty JSON of one entry when unitViews cut raw.
export const fullRawText = (t: Transcript, uuid: string): string | null => {
  const e = byUuid(t).get(uuid);
  return e ? JSON.stringify(e, null, 2) : null;
};
