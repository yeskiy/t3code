import type { OrchestrationV2ProviderThread } from "@t3tools/contracts";

type ClaudeSessionSpan = NonNullable<
  NonNullable<OrchestrationV2ProviderThread["nativeMetadata"]>["forkClaudeSessions"]
>[number];

interface ProviderTurnOrdinal {
  readonly providerThreadId: string;
  readonly ordinal: number;
}

const CLAUDE_DRIVER = "claudeAgent";

const spansOf = (providerThread: OrchestrationV2ProviderThread) =>
  providerThread.nativeMetadata?.forkClaudeSessions;

const nativeIdOf = (providerThread: OrchestrationV2ProviderThread) =>
  providerThread.nativeThreadRef?.nativeId ?? null;

// Appends the session with the turns recorded after the last known span. A session with none adds nothing.
const appendSpan = (
  providerThread: OrchestrationV2ProviderThread,
  sessionId: string,
  providerTurns: ReadonlyArray<ProviderTurnOrdinal>,
): ReadonlyArray<ClaudeSessionSpan> => {
  const spans = spansOf(providerThread) ?? [];
  const firstTurnOrdinal = Math.max(0, ...spans.map((span) => span.lastTurnOrdinal)) + 1;
  const lastTurnOrdinal = Math.max(
    0,
    ...providerTurns
      .filter((turn) => turn.providerThreadId === providerThread.id)
      .map((turn) => turn.ordinal),
  );
  return lastTurnOrdinal < firstTurnOrdinal
    ? spans
    : [...spans, { sessionId, firstTurnOrdinal, lastTurnOrdinal }];
};

const withSpans = (
  providerThread: OrchestrationV2ProviderThread,
  spans: ReadonlyArray<ClaudeSessionSpan>,
): OrchestrationV2ProviderThread => {
  const { forkClaudeRecoverOnResume: _flag, ...metadata } = providerThread.nativeMetadata ?? {};
  return { ...providerThread, nativeMetadata: { ...metadata, forkClaudeSessions: [...spans] } };
};

// Session id that holds the turn, or undefined when the row never recorded its sessions.
export const claudeSessionOfTurn = (
  providerThread: OrchestrationV2ProviderThread,
  ordinal: number,
): string | undefined => {
  const spans = spansOf(providerThread);
  if (spans === undefined) return undefined;
  return (
    spans.find((span) => ordinal >= span.firstTurnOrdinal && ordinal <= span.lastTurnOrdinal)
      ?.sessionId ??
    nativeIdOf(providerThread) ??
    undefined
  );
};

// A recovery replaced the Claude session: keep which turns the old session holds.
export const withReplacedClaudeSession = (input: {
  readonly previous: OrchestrationV2ProviderThread;
  readonly replacement: OrchestrationV2ProviderThread;
  readonly providerTurns: ReadonlyArray<ProviderTurnOrdinal>;
}): OrchestrationV2ProviderThread => {
  const previousId = nativeIdOf(input.previous);
  if (
    input.previous.driver !== CLAUDE_DRIVER ||
    previousId === null ||
    previousId === nativeIdOf(input.replacement)
  ) {
    return input.replacement;
  }
  const spans = appendSpan(input.previous, previousId, input.providerTurns);
  return withSpans(
    { ...input.replacement, nativeMetadata: input.replacement.nativeMetadata ?? null },
    spans,
  );
};

// A rewind into an older session makes it current and forgets the sessions after it.
export const withRestoredClaudeSession = (
  providerThread: OrchestrationV2ProviderThread,
  sessionId: string,
): OrchestrationV2ProviderThread => {
  const spans = spansOf(providerThread) ?? [];
  const index = spans.findIndex((span) => span.sessionId === sessionId);
  return withSpans(
    {
      ...providerThread,
      nativeThreadRef: { driver: providerThread.driver, nativeId: sessionId, strength: "strong" },
    },
    index < 0 ? spans : spans.slice(0, index),
  );
};

// A rewind with no resumable session moves to a fresh one that the next resume replaces with a handoff.
export const withAbandonedClaudeSession = (input: {
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly freshSessionId: string;
  readonly providerTurns: ReadonlyArray<ProviderTurnOrdinal>;
}): OrchestrationV2ProviderThread => {
  const currentId = nativeIdOf(input.providerThread);
  const spans =
    currentId === null
      ? (spansOf(input.providerThread) ?? [])
      : appendSpan(input.providerThread, currentId, input.providerTurns);
  const moved = withSpans(
    {
      ...input.providerThread,
      nativeThreadRef: {
        driver: input.providerThread.driver,
        nativeId: input.freshSessionId,
        strength: "strong",
      },
      nativeConversationHeadRef: null,
    },
    spans,
  );
  return {
    ...moved,
    nativeMetadata: { ...moved.nativeMetadata, forkClaudeRecoverOnResume: true },
  };
};

export const needsFreshClaudeSession = (providerThread: OrchestrationV2ProviderThread): boolean =>
  providerThread.nativeMetadata?.forkClaudeRecoverOnResume === true;

// An error result with no buffered frame before it ends a failed start, not a background wake.
export const isOrphanClaudeErrorResult = (
  message: { readonly type: string; readonly is_error?: boolean },
  bufferedFrames: number,
): boolean => message.type === "result" && message.is_error === true && bufferedFrames === 0;

// History length up to the resume point, or null when the transcript does not hold it.
export const claudeResumeBoundary = (
  messages: ReadonlyArray<{ readonly uuid: string }>,
  resumeSessionAt: string | undefined,
): number | null => {
  if (resumeSessionAt === undefined) return messages.length;
  const index = messages.findIndex((message) => message.uuid === resumeSessionAt);
  return index < 0 ? null : index + 1;
};
