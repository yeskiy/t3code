const base = {
  sessionId: "s-1",
  cwd: "C:\\work",
  version: "2.1.0",
  userType: "external",
  isSidechain: false,
};

const at = (n: number) => `2026-11-25T10:00:${String(n).padStart(2, "0")}.000Z`;

export const FIXTURE_LINES = [
  { type: "summary", summary: "start", leafUuid: "u1" },
  {
    ...base,
    type: "user",
    uuid: "u1",
    parentUuid: null,
    timestamp: at(1),
    message: { role: "user", content: "one" },
  },
  {
    ...base,
    type: "assistant",
    uuid: "a1t",
    parentUuid: "u1",
    timestamp: at(2),
    message: {
      id: "msg_1",
      role: "assistant",
      content: [{ type: "thinking", thinking: "hm", signature: "sig" }],
    },
  },
  {
    ...base,
    type: "assistant",
    uuid: "a1",
    parentUuid: "a1t",
    timestamp: at(3),
    message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "reply one" }] },
  },
  {
    ...base,
    type: "assistant",
    uuid: "a2",
    parentUuid: "a1",
    timestamp: at(4),
    message: {
      id: "msg_2",
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
    },
  },
  {
    ...base,
    type: "user",
    uuid: "r1",
    parentUuid: "a2",
    timestamp: at(5),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }],
    },
  },
  {
    ...base,
    type: "assistant",
    uuid: "a3",
    parentUuid: "r1",
    timestamp: at(6),
    message: { id: "msg_3", role: "assistant", content: [{ type: "text", text: "done" }] },
  },
  {
    ...base,
    type: "user",
    uuid: "u2",
    parentUuid: "a3",
    timestamp: at(7),
    message: { role: "user", content: "two" },
  },
  {
    ...base,
    type: "assistant",
    uuid: "a4",
    parentUuid: "u2",
    timestamp: at(8),
    message: { id: "msg_4", role: "assistant", content: [{ type: "text", text: "reply two" }] },
  },
  { type: "last-prompt", leafUuid: "a4", lastPrompt: "two", sessionId: "s-1" },
];

export const FIXTURE_TEXT = `${FIXTURE_LINES.map((l) => JSON.stringify(l)).join("\n")}\n`;

const assistantLine = (uuid: string, parentUuid: string, n: number, block: object) => ({
  ...base,
  type: "assistant",
  uuid,
  parentUuid,
  timestamp: at(n),
  message: { id: "msg_5", role: "assistant", content: [block] },
});

// A compaction cuts the chain: the boundary has no parent, so the active path starts there.
const COMPACTED_FIXTURE_LINES = [
  ...FIXTURE_LINES.slice(1, 4),
  {
    ...base,
    type: "system",
    subtype: "compact_boundary",
    uuid: "b1",
    parentUuid: null,
    logicalParentUuid: "a1",
    timestamp: at(10),
    content: "Conversation compacted",
  },
  {
    ...base,
    type: "user",
    uuid: "s1",
    parentUuid: "b1",
    isCompactSummary: true,
    timestamp: at(11),
    message: { role: "user", content: "summary of one" },
  },
  {
    ...base,
    type: "user",
    uuid: "u3",
    parentUuid: "s1",
    timestamp: at(12),
    message: { role: "user", content: "three" },
  },
  assistantLine("a5t", "u3", 13, { type: "thinking", thinking: "plan", signature: "sig5" }),
  assistantLine("a5", "a5t", 14, { type: "text", text: "reply three" }),
  assistantLine("a5b", "a5", 15, { type: "text", text: "more three" }),
  { type: "last-prompt", leafUuid: "a5b", lastPrompt: "three", sessionId: "s-1" },
];

export const COMPACTED_FIXTURE_TEXT = `${COMPACTED_FIXTURE_LINES.map((l) => JSON.stringify(l)).join("\n")}\n`;

const attachmentLine = (uuid: string, parentUuid: string | null, n: number, type: string) => ({
  ...base,
  type: "attachment",
  uuid,
  parentUuid,
  timestamp: at(n),
  attachment: { type },
});

const HANDOFF_TEXT =
  "Context handoff (delta_since_target_last_seen):\nProvider context handoff. Thread: thread-1. Covered app runs: 1-3.\n\nUser message:\nI stopped it.";

// A session that T3 started after a failed resume: hook attachments, the handoff prompt, a refusal.
const handoffFixtureLines = (firstPrompt: string) => [
  attachmentLine("h0", null, 20, "hook_success"),
  attachmentLine("h0b", "h0", 21, "hook_additional_context"),
  {
    ...base,
    type: "user",
    uuid: "h1",
    parentUuid: "h0b",
    timestamp: at(22),
    message: { role: "user", content: firstPrompt },
  },
  attachmentLine("h1e", "h1", 23, "environment"),
  attachmentLine("h1p", "h1e", 24, "prompt_snapshot"),
  { type: "last-prompt", leafUuid: "h1p", lastPrompt: "I stopped it.", sessionId: "s-1" },
  {
    ...base,
    type: "system",
    subtype: "informational",
    uuid: "n1",
    parentUuid: "h1p",
    timestamp: at(25),
    content: "The safeguards stopped the response above.",
  },
  {
    ...base,
    type: "user",
    uuid: "m1",
    parentUuid: "n1",
    isMeta: true,
    timestamp: at(26),
    message: { role: "user", content: "Your response above was stopped." },
  },
  {
    ...base,
    type: "user",
    uuid: "i1",
    parentUuid: "m1",
    timestamp: at(27),
    message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
  },
  { type: "last-prompt", leafUuid: "i1", lastPrompt: "I stopped it.", sessionId: "s-1" },
];

export const handoffFixtureText = (firstPrompt = HANDOFF_TEXT) =>
  `${handoffFixtureLines(firstPrompt)
    .map((l) => JSON.stringify(l))
    .join("\n")}\n`;
