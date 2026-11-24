// fork: build the one-shot wake prompt when Antigravity's 30-minute command hold expires.
import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";

const MAX_COMMAND_TITLE_LENGTH = 160;
const GENERIC_COMMAND_TITLES = new Set(["Ran command", "Run command", "Command"]);

function formatCommandTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return undefined;
  return normalized.length <= MAX_COMMAND_TITLE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_COMMAND_TITLE_LENGTH - 3)}...`;
}

function extractCommandLabel(command: AcpToolCallState): string | undefined {
  const title = formatCommandTitle(command.title);
  if (title !== undefined && !GENERIC_COMMAND_TITLES.has(title)) {
    return title;
  }
  return formatCommandTitle(command.detail) ?? formatCommandTitle(command.command);
}

export function buildAntigravityHoldWakePrompt(commands: ReadonlyArray<AcpToolCallState>): string {
  const titles: Array<string> = [];
  const seen = new Set<string>();
  for (const command of commands) {
    const title = extractCommandLabel(command);
    if (title === undefined || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  const subject =
    titles.length === 0
      ? "A background command you started"
      : `A background command you started (${titles.join(", ")})`;
  return `${subject} has had no update for 30 minutes. Report now: what finished, what still runs, and how to check it later. Do not start another long command.`;
}
