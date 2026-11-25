export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Block = { type: string; [key: string]: unknown };

export type Entry = {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: string | Block[];
    [key: string]: unknown;
  };
  content?: unknown;
  leafUuid?: string;
  lastPrompt?: string;
  [key: string]: unknown;
};

// raw holds the original text of an untouched line. A changed line has no raw and serializes from entry.
export type Line = { raw?: string; entry: Entry | null };

export type Transcript = {
  lines: readonly Line[];
  trailingNewline: boolean;
  sessionId: string | null;
};
