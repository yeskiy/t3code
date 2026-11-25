import { serializeJsonl } from "./jsonl.ts";
import type { Json, Transcript } from "./types.ts";

const SESSION_KEYS = new Set(["sessionId", "session_id"]);

const rewrite = (value: Json, from: string, to: string): Json =>
  Array.isArray(value)
    ? value.map((v) => rewrite(v, from, to))
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            SESSION_KEYS.has(k) && v === from ? to : rewrite(v, from, to),
          ]),
        )
      : value;

// A copy resumes as its own session, so every matching sessionId and session_id gets the new id.
export const serializeCopy = (t: Transcript, newSessionId: string): string => {
  const from = t.sessionId;
  if (from === null) return serializeJsonl(t);
  return serializeJsonl({
    ...t,
    sessionId: newSessionId,
    lines: t.lines.map((l) => {
      if (!l.entry) return l;
      const text = l.raw ?? JSON.stringify(l.entry);
      return text.includes(from)
        ? { entry: rewrite(l.entry as Json, from, newSessionId) as typeof l.entry }
        : l;
    }),
  });
};
