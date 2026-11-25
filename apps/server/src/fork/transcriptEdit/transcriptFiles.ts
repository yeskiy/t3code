import { type ForkTranscriptBackup, ForkTranscriptEditError } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { parseJsonl } from "./core/jsonl.ts";
import { conversationKey } from "./core/key.ts";
import type { Transcript } from "./core/types.ts";

export const BACKUPS_KEPT = 20;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const T3_BACKUP_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.jsonl$/;
const LEGACY_BACKUP_PATTERN = /^(.+)\.jsonl\.(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.bak$/;
const DEFAULT_SETTLE_PAUSE_MS = 400;
const DEFAULT_SETTLE_TRIES = 10;

export interface FreshTranscript {
  readonly path: string;
  readonly text: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly base: Transcript;
  readonly key: string;
}

interface BackupRefInput {
  readonly stateDir: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly name: string;
  readonly source: "t3" | "legacy";
}

interface DatedBackup extends ForkTranscriptBackup {
  readonly epochMs: number;
}

const isValidSessionId = (sessionId: string): boolean => SESSION_ID_PATTERN.test(sessionId);

const formatStamp = (epochMs: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(epochMs))
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const t3BackupName = (epochMs: number): string => `${formatStamp(epochMs)}.jsonl`;

const parseStampParts = (
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
): { readonly createdAt: string; readonly epochMs: number } | null => {
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const parsed = DateTime.make(iso);
  if (Option.isNone(parsed)) return null;
  const formatted = DateTime.formatIso(parsed.value);
  return formatted.startsWith(iso.slice(0, 19))
    ? { createdAt: formatted, epochMs: parsed.value.epochMilliseconds }
    : null;
};

const parseT3BackupName = (name: string) => {
  const match = T3_BACKUP_PATTERN.exec(name);
  if (match === null) return null;
  return parseStampParts(match[1]!, match[2]!, match[3]!, match[4]!, match[5]!, match[6]!);
};

const parseLegacyBackupName = (sessionId: string, name: string) => {
  const match = LEGACY_BACKUP_PATTERN.exec(name);
  if (match === null || match[1] !== sessionId) return null;
  return parseStampParts(match[2]!, match[3]!, match[4]!, match[5]!, match[6]!, match[7]!);
};

export const backupDir = (stateDir: string, sessionId: string): string => {
  const sep = stateDir.includes("\\") ? "\\" : "/";
  const trimmed = stateDir.replace(/[\\/]+$/, "");
  return [trimmed, "fork", "transcript-edit", "backups", sessionId].join(sep);
};

export const locateTranscript = Effect.fn("fork.transcriptEdit.locateTranscript")(
  function* (input: {
    readonly configDir: string;
    readonly sessionId: string;
  }): Effect.fn.Return<string | null, never, FileSystem.FileSystem | Path.Path> {
    if (!isValidSessionId(input.sessionId)) return null;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projectsDir = path.join(input.configDir, "projects");
    const projects = yield* fs
      .readDirectory(projectsDir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const candidates = yield* Effect.forEach(projects, (project) => {
      const candidate = path.join(projectsDir, project, `${input.sessionId}.jsonl`);
      return fs.stat(candidate).pipe(
        Effect.map((info) =>
          info.type === "File"
            ? { path: candidate, mtimeMs: Option.getOrUndefined(info.mtime)?.getTime() ?? 0 }
            : null,
        ),
        Effect.orElseSucceed(() => null),
      );
    });
    const newest = candidates.reduce<{ readonly path: string; readonly mtimeMs: number } | null>(
      (best, entry) => {
        if (entry === null) return best;
        if (best === null || entry.mtimeMs > best.mtimeMs) return entry;
        return best;
      },
      null,
    );
    return newest?.path ?? null;
  },
);

export const readFresh = Effect.fn("fork.transcriptEdit.readFresh")(function* (
  filePath: string,
): Effect.fn.Return<FreshTranscript, PlatformError.PlatformError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(filePath);
  const info = yield* fs.stat(filePath);
  const base = parseJsonl(text);
  return {
    path: filePath,
    text,
    size: Number(info.size),
    mtimeMs: Option.getOrUndefined(info.mtime)?.getTime() ?? 0,
    base,
    key: conversationKey(base),
  };
});

export const settle = Effect.fn("fork.transcriptEdit.settle")(function* (
  filePath: string,
  pauseMs = DEFAULT_SETTLE_PAUSE_MS,
  tries = DEFAULT_SETTLE_TRIES,
): Effect.fn.Return<void, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const readStamp = () =>
    fs.stat(filePath).pipe(
      Effect.map((info) => ({
        size: Number(info.size),
        mtimeMs: Option.getOrUndefined(info.mtime)?.getTime() ?? 0,
      })),
      Effect.option,
    );
  // Shares the enclosing settle span across comparison rounds.
  const step = Effect.fnUntraced(function* (remaining: number): Effect.fn.Return<void> {
    if (remaining <= 0) return;
    const first = yield* readStamp();
    yield* Effect.sleep(Duration.millis(pauseMs));
    const second = yield* readStamp();
    const settled =
      Option.isSome(first) &&
      Option.isSome(second) &&
      first.value.size === second.value.size &&
      first.value.mtimeMs === second.value.mtimeMs;
    if (settled || remaining <= 1) return;
    yield* step(remaining - 1);
  });
  yield* step(tries);
});

export const writeBackup = Effect.fn("fork.transcriptEdit.writeBackup")(function* (input: {
  readonly stateDir: string;
  readonly sessionId: string;
  readonly text: string;
  readonly now: Date;
}): Effect.fn.Return<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  if (!isValidSessionId(input.sessionId)) {
    return yield* PlatformError.badArgument({
      module: "FileSystem",
      method: "writeBackup",
      description: "Invalid session id.",
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(input.stateDir, "fork", "transcript-edit", "backups", input.sessionId);
  yield* fs.makeDirectory(dir, { recursive: true });
  const existing = yield* fs
    .readDirectory(dir)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const taken = new Set(existing);
  const baseMs = input.now.getTime();
  const offset =
    Array.from({ length: taken.size + 1 }, (_, i) => i).find(
      (i) => !taken.has(t3BackupName(baseMs + i * 1000)),
    ) ?? 0;
  const name = t3BackupName(baseMs + offset * 1000);
  yield* writeFileStringAtomically({ filePath: path.join(dir, name), contents: input.text });
  return name;
});

// Shares the enclosing listBackups or pruneBackups span.
const collectBackups = Effect.fnUntraced(function* (input: {
  readonly dir: string;
  readonly source: "t3" | "legacy";
  readonly parse: (name: string) => { readonly createdAt: string; readonly epochMs: number } | null;
}): Effect.fn.Return<ReadonlyArray<DatedBackup>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs
    .readDirectory(input.dir)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const matched = names.flatMap((name) => {
    const parsed = input.parse(name);
    return parsed === null ? [] : [{ name, ...parsed }];
  });
  const entries = yield* Effect.forEach(matched, (entry) =>
    fs.stat(path.join(input.dir, entry.name)).pipe(
      Effect.map((info): DatedBackup | null =>
        info.type === "File"
          ? {
              name: entry.name,
              source: input.source,
              createdAt: entry.createdAt,
              size: Number(info.size),
              epochMs: entry.epochMs,
            }
          : null,
      ),
      Effect.orElseSucceed(() => null),
    ),
  );
  return entries.filter((entry): entry is DatedBackup => entry !== null);
});

export const listBackups = Effect.fn("fork.transcriptEdit.listBackups")(function* (input: {
  readonly stateDir: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
}): Effect.fn.Return<
  ReadonlyArray<ForkTranscriptBackup>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  if (!isValidSessionId(input.sessionId)) return [];
  const path = yield* Path.Path;
  const t3Dir = path.join(input.stateDir, "fork", "transcript-edit", "backups", input.sessionId);
  const legacyDir = path.dirname(input.transcriptPath);
  const t3Entries = yield* collectBackups({
    dir: t3Dir,
    source: "t3",
    parse: parseT3BackupName,
  });
  const legacyEntries = yield* collectBackups({
    dir: legacyDir,
    source: "legacy",
    parse: (name) => parseLegacyBackupName(input.sessionId, name),
  });
  return [...t3Entries, ...legacyEntries]
    .toSorted((a, b) => b.epochMs - a.epochMs || a.name.localeCompare(b.name))
    .map(({ name, source, createdAt, size }): ForkTranscriptBackup => ({
      name,
      source,
      createdAt,
      size,
    }));
});

// Shares the enclosing readBackup or deleteBackup span.
const resolveBackupPath = Effect.fnUntraced(function* (
  input: BackupRefInput,
): Effect.fn.Return<string, ForkTranscriptEditError, Path.Path> {
  const valid =
    isValidSessionId(input.sessionId) &&
    (input.source === "t3"
      ? parseT3BackupName(input.name) !== null
      : parseLegacyBackupName(input.sessionId, input.name) !== null);
  if (!valid) {
    return yield* new ForkTranscriptEditError({
      code: "badBackup",
      detail: "Backup name is not valid for this session.",
    });
  }
  const path = yield* Path.Path;
  const dir =
    input.source === "t3"
      ? path.join(input.stateDir, "fork", "transcript-edit", "backups", input.sessionId)
      : path.dirname(input.transcriptPath);
  const resolved = path.resolveWithin(dir, input.name);
  if (Option.isNone(resolved)) {
    return yield* new ForkTranscriptEditError({
      code: "badBackup",
      detail: "Backup path escapes the backup folder.",
    });
  }
  return resolved.value;
});

export const readBackup = Effect.fn("fork.transcriptEdit.readBackup")(function* (
  input: BackupRefInput,
): Effect.fn.Return<string, ForkTranscriptEditError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const filePath = yield* resolveBackupPath(input);
  return yield* fs.readFileString(filePath).pipe(
    Effect.mapError(
      () =>
        new ForkTranscriptEditError({
          code: "badBackup",
          detail: `Backup file ${input.name} cannot be read.`,
        }),
    ),
  );
});

export const deleteBackup = Effect.fn("fork.transcriptEdit.deleteBackup")(function* (
  input: BackupRefInput,
): Effect.fn.Return<void, ForkTranscriptEditError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const filePath = yield* resolveBackupPath(input);
  yield* fs.remove(filePath).pipe(
    Effect.mapError(
      (error) =>
        new ForkTranscriptEditError({
          code: error.reason._tag === "NotFound" ? "badBackup" : "writeFailed",
          detail: `Backup file ${input.name} cannot be deleted.`,
        }),
    ),
  );
});

export const pruneBackups = Effect.fn("fork.transcriptEdit.pruneBackups")(function* (input: {
  readonly stateDir: string;
  readonly sessionId: string;
  readonly keep: number;
}): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
  if (!isValidSessionId(input.sessionId)) return;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(input.stateDir, "fork", "transcript-edit", "backups", input.sessionId);
  const entries = yield* collectBackups({
    dir,
    source: "t3",
    parse: parseT3BackupName,
  });
  const keep = Math.max(0, Math.floor(input.keep));
  const stale = entries
    .toSorted((a, b) => b.epochMs - a.epochMs || a.name.localeCompare(b.name))
    .slice(keep);
  yield* Effect.forEach(
    stale,
    (entry) => fs.remove(path.join(dir, entry.name)).pipe(Effect.ignore),
    { discard: true },
  );
});

export const writeTranscript = Effect.fn("fork.transcriptEdit.writeTranscript")(function* (
  filePath: string,
  text: string,
): Effect.fn.Return<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  yield* writeFileStringAtomically({ filePath, contents: text });
});
