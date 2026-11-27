import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ClaudeRestartReason = Schema.Literals([
  "workspace",
  "model",
  "permissions",
  "mcp",
  "other",
]);
export type ClaudeRestartReason = typeof ClaudeRestartReason.Type;

/** Background work that a new Claude process would end. */
export const ClaudeRestartBlockingItem = Schema.Struct({
  taskId: TrimmedNonEmptyString,
  kind: Schema.Literals(["command", "agent"]),
  description: Schema.String,
});
export type ClaudeRestartBlockingItem = typeof ClaudeRestartBlockingItem.Type;

const CLAUDE_RESTART_BLOCKED_PREFIX = "Claude must restart because";

const REASON_TEXT: Record<ClaudeRestartReason, string> = {
  workspace: "a project folder outside the working folder changed",
  model: "the model or its settings changed",
  permissions: "the permission settings changed",
  mcp: "the MCP (Model Context Protocol) tool servers changed",
  other: "it must start a new session",
};

const LISTED_ITEMS = 5;
const DESCRIPTION_LENGTH = 80;

const itemText = (item: ClaudeRestartBlockingItem) => {
  const text = item.description.replace(/\s+/gu, " ").trim() || item.taskId;
  return `${text.length > DESCRIPTION_LENGTH ? `${text.slice(0, DESCRIPTION_LENGTH - 3)}...` : text} (${item.kind})`;
};

export const claudeRestartBlockedMessage = (
  reason: ClaudeRestartReason,
  items: ReadonlyArray<ClaudeRestartBlockingItem>,
): string => {
  const listed = items.slice(0, LISTED_ITEMS).map(itemText);
  const more = items.length > LISTED_ITEMS ? [`${items.length - LISTED_ITEMS} more`] : [];
  const work =
    listed.length === 0
      ? "Claude still runs background work, and a restart would end it."
      : `These background tasks would end: ${[...listed, ...more].join(", ")}.`;
  return `${CLAUDE_RESTART_BLOCKED_PREFIX} ${REASON_TEXT[reason]}. ${work} Wait for them to finish, or stop them, then send the message again.`;
};

export const isClaudeRestartBlockedMessage = (text: string | null | undefined): boolean =>
  text?.startsWith(CLAUDE_RESTART_BLOCKED_PREFIX) === true;
