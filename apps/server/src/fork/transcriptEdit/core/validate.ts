import {
  activeLeaf,
  activePath,
  blocks,
  buildUnits,
  byUuid,
  entries,
  isConversation,
  walkToRoot,
} from "./model.ts";
import type { Entry, Transcript } from "./types.ts";

export type IssueCode =
  | "duplicate-uuid"
  | "missing-leaf"
  | "broken-chain"
  | "unanswered-tool-use"
  | "orphan-tool-result"
  | "thinking-modified"
  | "no-conversation"
  | "leaf-not-message";

export type Issue = { code: IssueCode; message: string; uuid?: string };

export type Validation = { errors: Issue[]; warnings: Issue[] };

const THINKING = new Set(["thinking", "redacted_thinking"]);

const duplicates = (t: Transcript) =>
  entries(t).reduce<{ seen: Set<string>; dupes: Set<string> }>(
    (acc, e) => {
      if (typeof e.uuid !== "string") return acc;
      if (acc.seen.has(e.uuid)) acc.dupes.add(e.uuid);
      else acc.seen.add(e.uuid);
      return acc;
    },
    { seen: new Set<string>(), dupes: new Set<string>() },
  ).dupes;

const chainIssues = (t: Transcript): Issue[] => {
  const leaf = activeLeaf(t);
  const map = byUuid(t);
  if (leaf === null || !map.has(leaf)) {
    return [
      {
        code: "missing-leaf",
        message: "The latest last-prompt points to an entry that does not exist.",
        ...(leaf !== null ? { uuid: leaf } : {}),
      },
    ];
  }
  const walk = walkToRoot(map, leaf);
  if (walk.complete) return [];
  const firstUuid = walk.path[0]?.uuid;
  return [
    {
      code: "broken-chain",
      message: "The chain from the leaf does not reach the root.",
      ...(firstUuid !== undefined ? { uuid: firstUuid } : {}),
    },
  ];
};

// Groups the path into API turns: consecutive user entries form one turn, and consecutive assistant entries form one turn.
const turns = (path: Entry[]) =>
  path
    .filter((e) => e.type === "user" || e.type === "assistant")
    .reduce<{ role: string; entries: Entry[] }[]>((acc, e) => {
      const last = acc.at(-1);
      if (last && last.role === e.type) last.entries.push(e);
      else acc.push({ role: e.type as string, entries: [e] });
      return acc;
    }, []);

const ids = (es: Entry[], type: string, key: string) =>
  es.flatMap((e) =>
    blocks(e).flatMap((b) => (b.type === type && typeof b[key] === "string" ? [b[key]] : [])),
  );

// Results of parallel calls can sit on side branches off the path. They answer the call they hang from.
const sideResults = (t: Transcript): Map<string, Entry[]> => {
  const map = byUuid(t);
  const grouped = new Map<string, Entry[]>();
  buildUnits(t).forEach((u) => {
    u.side.forEach((id) => {
      const e = map.get(id);
      if (!e) return;
      const parent = e.parentUuid ?? "";
      const list = grouped.get(parent);
      if (list) list.push(e);
      else grouped.set(parent, [e]);
    });
  });
  return grouped;
};

const toolIssues = (t: Transcript): Issue[] => {
  const side = sideResults(t);
  return turns(activePath(t)).flatMap((turn, i, all) => {
    if (turn.role === "assistant") {
      const next = all[i + 1]?.role === "user" ? (all[i + 1]?.entries ?? []) : [];
      const answered = new Set(
        ids(
          [...next, ...turn.entries.flatMap((e) => side.get(e.uuid ?? "") ?? [])],
          "tool_result",
          "tool_use_id",
        ),
      );
      return ids(turn.entries, "tool_use", "id")
        .filter((id) => !answered.has(id))
        .map((id): Issue => ({
          code: "unanswered-tool-use",
          message: `Tool call ${id} has no tool_result.`,
          uuid: id,
        }));
    }
    const asked = new Set(
      all[i - 1]?.role === "assistant" ? ids(all[i - 1]?.entries ?? [], "tool_use", "id") : [],
    );
    return ids(turn.entries, "tool_result", "tool_use_id")
      .filter((id) => !asked.has(id))
      .map((id): Issue => ({
        code: "orphan-tool-result",
        message: `Tool result ${id} has no tool_use in the previous assistant message.`,
        uuid: id,
      }));
  });
};

// Claude resumes at the last message of the active path, so that message must be a user or assistant one.
const conversationIssues = (t: Transcript): Issue[] => {
  const path = activePath(t);
  if (!path.some(isConversation)) {
    return [
      {
        code: "no-conversation",
        message:
          "The edit removes every user and assistant message. Claude would have no conversation to resume.",
      },
    ];
  }
  const last = path.findLast(
    (e) => e.type === "user" || e.type === "assistant" || e.type === "system",
  );
  return isConversation(last)
    ? []
    : [
        {
          code: "leaf-not-message",
          message: "The conversation must end with a user or assistant message.",
          ...(last?.uuid !== undefined ? { uuid: last.uuid } : {}),
        },
      ];
};

const thinkingBlocks = (t: Transcript) =>
  entries(t).flatMap((e) =>
    blocks(e)
      .filter((b) => THINKING.has(b.type))
      .map((b) => ({ uuid: e.uuid, json: JSON.stringify(b) })),
  );

const thinkingIssues = (original: Transcript, edited: Transcript): Issue[] => {
  const known = new Set(thinkingBlocks(original).map((b) => b.json));
  return thinkingBlocks(edited)
    .filter((b) => !known.has(b.json))
    .map((b): Issue => ({
      code: "thinking-modified",
      message: "A thinking block differs from the original. Its signature no longer matches.",
      ...(b.uuid !== undefined ? { uuid: b.uuid } : {}),
    }));
};

// Duplicate uuids, unanswered tool calls, and a non-message end count only when the edit made them.
export const validate = (original: Transcript, edited: Transcript): Validation => {
  const before = duplicates(original);
  const dupes = [...duplicates(edited)].filter((id) => !before.has(id));
  const known = new Set(
    toolIssues(original)
      .filter((i) => i.code === "unanswered-tool-use")
      .map((i) => i.uuid),
  );
  const tools = toolIssues(edited);
  const old = (i: Issue) => i.code === "unanswered-tool-use" && known.has(i.uuid);
  const endedOnSystem = conversationIssues(original).some((i) => i.code === "leaf-not-message");
  const ends = conversationIssues(edited);
  const oldEnd = (i: Issue) => i.code === "leaf-not-message" && endedOnSystem;
  return {
    errors: [
      ...dupes.map((uuid): Issue => ({
        code: "duplicate-uuid",
        message: `The uuid ${uuid} occurs more than once.`,
        uuid,
      })),
      ...chainIssues(edited),
      ...tools.filter((i) => !old(i)),
      ...thinkingIssues(original, edited),
      ...ends.filter((i) => !oldEnd(i)),
    ],
    warnings: [...tools.filter(old), ...ends.filter(oldEnd)],
  };
};
