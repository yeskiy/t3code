import type { Entry, Line, Transcript } from "./types.ts";

const parseLine = (raw: string): Line => {
  try {
    const value: unknown = JSON.parse(raw);
    return {
      raw,
      entry:
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as Entry)
          : null,
    };
  } catch {
    return { raw, entry: null };
  }
};

const split = (text: string) => {
  const parts = text.split("\n");
  const trailingNewline = parts.at(-1) === "";
  return { raws: trailingNewline ? parts.slice(0, -1) : parts, trailingNewline };
};

const finish = (lines: Line[], trailingNewline: boolean): Transcript => ({
  lines,
  trailingNewline,
  sessionId:
    lines.map((l) => l.entry?.sessionId).find((id): id is string => typeof id === "string") ?? null,
});

export const parseJsonl = (text: string): Transcript => {
  const { raws, trailingNewline } = split(text);
  return finish(raws.map(parseLine), trailingNewline);
};

export const lineText = (line: Line): string => line.raw ?? JSON.stringify(line.entry);

export const serializeJsonl = (t: Transcript): string =>
  t.lines.map(lineText).join("\n") + (t.trailingNewline ? "\n" : "");
