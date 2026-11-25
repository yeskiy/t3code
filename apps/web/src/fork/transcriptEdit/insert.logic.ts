import type { ForkTranscriptOp, ForkTranscriptUnitView } from "@t3tools/contracts";

import { randomUUID } from "~/lib/utils";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const randomId = (length: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => ID_ALPHABET[byte % 62]).join(
    "",
  );

const parseTimeMs = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

// Builds a replayable insert op with fresh ids and a timestamp between neighbor units.
export const makeInsert = (
  units: ReadonlyArray<ForkTranscriptUnitView>,
  spec: { readonly role: "user" | "assistant"; readonly text: string; readonly index: number },
  now: Date = new Date(),
): Extract<ForkTranscriptOp, { kind: "insertMessage" }> => {
  const prev = parseTimeMs(units[spec.index - 1]?.time);
  const next = parseTimeMs(units[spec.index]?.time);
  const ms =
    prev !== null && next !== null
      ? Math.floor((prev + next) / 2)
      : prev !== null
        ? prev + 1
        : next !== null
          ? next - 1
          : now.getTime();
  return {
    kind: "insertMessage",
    role: spec.role,
    text: spec.text,
    index: spec.index,
    uuid: randomUUID(),
    timestamp: new Date(ms).toISOString(),
    messageId: spec.role === "assistant" ? `msg_${randomId(24)}` : null,
  };
};
