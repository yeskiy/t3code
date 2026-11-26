import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const CHAT_SESSION_ID = "0b6f3c3e-5a51-4c39-9d2a-6a3f1e2b7c01";
export const COMPACT_SESSION_ID = "0b6f3c3e-5a51-4c39-9d2a-6a3f1e2b7c02";

interface Turn {
  readonly user: string;
  readonly thinking?: string;
  readonly tool?: { readonly command: string; readonly output: string };
  readonly reply: string;
}

export const CHAT_TURNS: ReadonlyArray<Turn> = [
  {
    user: "List the files in the project.",
    thinking: "The user wants a file list.",
    tool: { command: "ls", output: "README.md\nindex.ts" },
    reply: "The project has two files: README.md and index.ts.",
  },
  { user: "Add a greeting to index.ts.", reply: "I added a greeting to index.ts." },
  { user: "Explain the greeting.", reply: "The greeting prints hello to the console." },
  { user: "Rename the greeting function.", reply: "I renamed the function to sayHello." },
  { user: "Summarize the changes.", reply: "Summary: one new function, sayHello." },
];

// Claude names a project folder after its working directory with every other character as "-".
export const claudeProjectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const chain = (sessionId: string, cwd: string, start: number) => {
  const state = { parent: null as string | null, n: 0 };
  const base = { sessionId, cwd, version: "2.1.0", userType: "external", isSidechain: false };
  return (fields: Record<string, unknown>, options: { readonly root?: boolean } = {}) => {
    state.n += 1;
    const uuid = `${sessionId.slice(0, 19)}${sessionId.slice(-4)}-${String(state.n).padStart(12, "0")}`;
    const entry = {
      ...base,
      uuid,
      parentUuid: options.root === true ? null : state.parent,
      timestamp: new Date(start + state.n * 1000).toISOString(),
      ...fields,
    };
    state.parent = uuid;
    return entry;
  };
};

const turnEntries = (next: ReturnType<typeof chain>, turn: Turn, index: number) => {
  const id = `msg_${String(index).padStart(3, "0")}`;
  return [
    next({ type: "user", message: { role: "user", content: turn.user } }),
    ...(turn.thinking === undefined
      ? []
      : [
          next({
            type: "assistant",
            message: {
              id: `${id}t`,
              role: "assistant",
              model: "claude-haiku-5-5",
              content: [{ type: "thinking", thinking: turn.thinking, signature: "sig" }],
            },
          }),
        ]),
    ...(turn.tool === undefined
      ? []
      : [
          next({
            type: "assistant",
            message: {
              id: `${id}u`,
              role: "assistant",
              model: "claude-haiku-5-5",
              content: [
                {
                  type: "tool_use",
                  id: `toolu_${index}`,
                  name: "Bash",
                  input: { command: turn.tool.command },
                },
              ],
            },
          }),
          next({
            type: "user",
            message: {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: `toolu_${index}`, content: turn.tool.output },
              ],
            },
          }),
        ]),
    next({
      type: "assistant",
      message: {
        id,
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: turn.reply }],
      },
    }),
  ];
};

const toJsonl = (entries: ReadonlyArray<unknown>) =>
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

export const chatSession = (cwd: string, start: number) => {
  const next = chain(CHAT_SESSION_ID, cwd, start);
  return toJsonl(CHAT_TURNS.flatMap((turn, index) => turnEntries(next, turn, index)));
};

export const COMPACT_TURNS: ReadonlyArray<Turn> = [
  { user: "Old question before compaction.", reply: "Old answer before compaction." },
  { user: "New question after compaction.", reply: "New answer after compaction." },
  { user: "Second question after compaction.", reply: "Second answer after compaction." },
];

export const compactSession = (cwd: string, start: number) => {
  const next = chain(COMPACT_SESSION_ID, cwd, start);
  const [before, ...after] = COMPACT_TURNS;
  return toJsonl([
    ...(before === undefined ? [] : turnEntries(next, before, 0)),
    next(
      {
        type: "system",
        subtype: "compact_boundary",
        content: "Conversation compacted",
        level: "info",
        compactMetadata: { trigger: "manual", preTokens: 1200 },
      },
      { root: true },
    ),
    next({
      type: "user",
      isCompactSummary: true,
      message: { role: "user", content: "This session continues from an earlier conversation." },
    }),
    ...after.flatMap((turn, index) => turnEntries(next, turn, index + 1)),
  ]);
};

/** Writes both fixture sessions into `<claudeDir>/projects/<slug>/` with fresh timestamps. */
export const writeFixtures = (claudeDir: string, cwd: string) => {
  const dir = NodePath.join(claudeDir, "projects", claudeProjectSlug(cwd));
  NodeFS.mkdirSync(dir, { recursive: true });
  const start = Date.now() - 10 * 60_000;
  NodeFS.writeFileSync(NodePath.join(dir, `${CHAT_SESSION_ID}.jsonl`), chatSession(cwd, start));
  NodeFS.writeFileSync(
    NodePath.join(dir, `${COMPACT_SESSION_ID}.jsonl`),
    compactSession(cwd, start + 60_000),
  );
  return {
    dir,
    chat: NodePath.join(dir, `${CHAT_SESSION_ID}.jsonl`),
    compact: NodePath.join(dir, `${COMPACT_SESSION_ID}.jsonl`),
  };
};
