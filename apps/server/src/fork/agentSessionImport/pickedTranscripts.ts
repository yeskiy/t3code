import type { ProviderInstanceId } from "@t3tools/contracts";

/** A Claude session file picked by id. An import reads it whatever its age. */
export interface ForkPickedTranscript {
  readonly filePath: string;
  readonly cwd: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly homePath: string;
  readonly mtimeMs: number;
}

export const forkPickedCandidates = (picked: ReadonlyArray<ForkPickedTranscript>) =>
  picked.map((transcript) => ({
    cwd: transcript.cwd,
    source: "claudeAgent" as const,
    providerInstanceId: transcript.providerInstanceId,
    homePath: transcript.homePath,
    threadCount: 1,
    lastActiveAtMs: transcript.mtimeMs,
    transcripts: [{ filePath: transcript.filePath, mtimeMs: transcript.mtimeMs }],
  }));
