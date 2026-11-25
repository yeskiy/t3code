// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect Digest is async, and conversationKey stays synchronous.
import * as NodeCrypto from "node:crypto";

import { lineText } from "./jsonl.ts";
import type { Transcript } from "./types.ts";

// Hashes only lines that carry a uuid so exit-time cost and last-prompt lines do not count.
export const conversationKey = (t: Transcript): string =>
  t.lines
    .filter((l) => typeof l.entry?.uuid === "string")
    .reduce((h, l) => h.update(lineText(l)).update("\n"), NodeCrypto.createHash("sha256"))
    .digest("base64url");
