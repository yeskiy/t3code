import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { FIXTURE_TEXT } from "./core/fixtures.ts";
import {
  BACKUPS_KEPT,
  backupDir,
  deleteBackup,
  listBackups,
  locateTranscript,
  pruneBackups,
  readBackup,
  readFresh,
  settle,
  writeBackup,
  writeTranscript,
} from "./transcriptFiles.ts";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_SESSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const utcDate = (iso: string): Date => DateTime.toDateUtc(DateTime.makeUnsafe(iso));

describe("transcriptFiles", () => {
  it("exports the default backup retention count", () => {
    expect(BACKUPS_KEPT).toBe(20);
  });

  it.effect("locateTranscript finds a session file and picks the newer of two copies", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-locate-" });
        const dirA = path.join(root, "projects", "C--a");
        const dirB = path.join(root, "projects", "C--b");
        yield* fs.makeDirectory(dirA, { recursive: true });
        yield* fs.makeDirectory(dirB, { recursive: true });

        const fileA = path.join(dirA, `${SESSION_ID}.jsonl`);
        const fileB = path.join(dirB, `${SESSION_ID}.jsonl`);
        yield* fs.writeFileString(fileA, FIXTURE_TEXT);
        const older = utcDate("2026-11-25T10:00:00.000Z");
        yield* fs.utimes(fileA, older, older);

        const single = yield* locateTranscript({ configDir: root, sessionId: SESSION_ID });
        expect(single).toBe(fileA);

        yield* fs.writeFileString(fileB, FIXTURE_TEXT);
        const newer = utcDate("2026-11-25T10:05:00.000Z");
        yield* fs.utimes(fileB, newer, newer);

        const chosen = yield* locateTranscript({ configDir: root, sessionId: SESSION_ID });
        expect(chosen).toBe(fileB);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("locateTranscript returns null for invalid or missing session ids", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-missing-" });
        yield* fs.makeDirectory(path.join(root, "projects", "C--a"), { recursive: true });

        expect(yield* locateTranscript({ configDir: root, sessionId: "../evil" })).toBeNull();
        expect(yield* locateTranscript({ configDir: root, sessionId: "not-a-uuid" })).toBeNull();
        expect(yield* locateTranscript({ configDir: root, sessionId: SESSION_ID })).toBeNull();
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("readFresh keeps the same key with and without a trailing cost line", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-fresh-" });
        const plainPath = path.join(root, "plain.jsonl");
        const costPath = path.join(root, "with-cost.jsonl");
        yield* fs.writeFileString(plainPath, FIXTURE_TEXT);
        yield* fs.writeFileString(costPath, `${FIXTURE_TEXT}{"type":"cost","total":1}\n`);

        const plain = yield* readFresh(plainPath);
        const withCost = yield* readFresh(costPath);

        expect(plain.path).toBe(plainPath);
        expect(plain.text).toBe(FIXTURE_TEXT);
        expect(plain.size).toBeGreaterThan(0);
        expect(plain.mtimeMs).toBeGreaterThan(0);
        expect(plain.base.lines.length).toBeGreaterThan(0);
        expect(withCost.key).toBe(plain.key);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writeBackup twice in the same second gives two names one second apart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-bak-" });
        const now = utcDate("2026-11-25T10:00:05.000Z");

        const first = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: FIXTURE_TEXT,
          now,
        });
        const second = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: `${FIXTURE_TEXT}\n`,
          now,
        });

        expect(first).toBe("20261125T100005Z.jsonl");
        expect(second).toBe("20261125T100006Z.jsonl");
        const dir = backupDir(stateDir, SESSION_ID);
        expect(yield* fs.readFileString(path.join(dir, first))).toBe(FIXTURE_TEXT);
        expect(yield* fs.readFileString(path.join(dir, second))).toBe(`${FIXTURE_TEXT}\n`);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("listBackups returns both t3 and legacy backups newest first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-list-" });
        const stateDir = path.join(root, "state");
        const projectDir = path.join(root, "projects", "C--a");
        yield* fs.makeDirectory(projectDir, { recursive: true });
        const transcriptPath = path.join(projectDir, `${SESSION_ID}.jsonl`);
        yield* fs.writeFileString(transcriptPath, FIXTURE_TEXT);

        const t3Name = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: "t3-body",
          now: utcDate("2026-11-25T10:00:00.000Z"),
        });
        const legacyName = `${SESSION_ID}.jsonl.20261125T110000Z.bak`;
        yield* fs.writeFileString(path.join(projectDir, legacyName), "legacy-body");
        yield* fs.writeFileString(
          path.join(projectDir, `${OTHER_SESSION_ID}.jsonl.20261125T120000Z.bak`),
          "other-session",
        );
        yield* fs.writeFileString(
          path.join(backupDir(stateDir, SESSION_ID), "20260230T000000Z.jsonl"),
          "invalid-date",
        );

        const backups = yield* listBackups({ stateDir, sessionId: SESSION_ID, transcriptPath });

        expect(backups).toEqual([
          {
            name: legacyName,
            source: "legacy",
            createdAt: "2026-11-25T11:00:00.000Z",
            size: 11,
          },
          {
            name: t3Name,
            source: "t3",
            createdAt: "2026-11-25T10:00:00.000Z",
            size: 7,
          },
        ]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("readBackup and deleteBackup validate names and operate on valid backups", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-readbak-" });
        const stateDir = path.join(root, "state");
        const projectDir = path.join(root, "projects", "C--a");
        yield* fs.makeDirectory(projectDir, { recursive: true });
        const transcriptPath = path.join(projectDir, `${SESSION_ID}.jsonl`);
        yield* fs.writeFileString(transcriptPath, FIXTURE_TEXT);

        const t3Name = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: "saved-t3",
          now: utcDate("2026-11-25T10:00:00.000Z"),
        });
        const legacyName = `${SESSION_ID}.jsonl.20261125T110000Z.bak`;
        yield* fs.writeFileString(path.join(projectDir, legacyName), "saved-legacy");

        const traversal = yield* Effect.flip(
          readBackup({
            stateDir,
            sessionId: SESSION_ID,
            transcriptPath,
            name: "../x.jsonl",
            source: "t3",
          }),
        );
        expect(traversal.code).toBe("badBackup");

        const wrongSource = yield* Effect.flip(
          readBackup({
            stateDir,
            sessionId: SESSION_ID,
            transcriptPath,
            name: legacyName,
            source: "t3",
          }),
        );
        expect(wrongSource.code).toBe("badBackup");

        const wrongDelete = yield* Effect.flip(
          deleteBackup({
            stateDir,
            sessionId: SESSION_ID,
            transcriptPath,
            name: "../x.jsonl",
            source: "legacy",
          }),
        );
        expect(wrongDelete.code).toBe("badBackup");

        expect(
          yield* readBackup({
            stateDir,
            sessionId: SESSION_ID,
            transcriptPath,
            name: t3Name,
            source: "t3",
          }),
        ).toBe("saved-t3");
        expect(
          yield* readBackup({
            stateDir,
            sessionId: SESSION_ID,
            transcriptPath,
            name: legacyName,
            source: "legacy",
          }),
        ).toBe("saved-legacy");

        yield* deleteBackup({
          stateDir,
          sessionId: SESSION_ID,
          transcriptPath,
          name: t3Name,
          source: "t3",
        });
        yield* deleteBackup({
          stateDir,
          sessionId: SESSION_ID,
          transcriptPath,
          name: legacyName,
          source: "legacy",
        });
        expect(yield* listBackups({ stateDir, sessionId: SESSION_ID, transcriptPath })).toEqual([]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("pruneBackups keeps the two newest of three t3 backups and ignores legacy files", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-prune-" });
        const stateDir = path.join(root, "state");
        const projectDir = path.join(root, "projects", "C--a");
        yield* fs.makeDirectory(projectDir, { recursive: true });
        const legacyName = `${SESSION_ID}.jsonl.20261125T080000Z.bak`;
        yield* fs.writeFileString(path.join(projectDir, legacyName), "old-legacy");

        const b1 = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: "one",
          now: utcDate("2026-11-25T10:00:00.000Z"),
        });
        const b2 = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: "two",
          now: utcDate("2026-11-25T10:01:00.000Z"),
        });
        const b3 = yield* writeBackup({
          stateDir,
          sessionId: SESSION_ID,
          text: "three",
          now: utcDate("2026-11-25T10:02:00.000Z"),
        });

        yield* pruneBackups({ stateDir, sessionId: SESSION_ID, keep: 2 });

        const remaining = (yield* fs.readDirectory(backupDir(stateDir, SESSION_ID))).toSorted();
        expect(remaining).toEqual([b2, b3]);
        expect(remaining).not.toContain(b1);
        expect(yield* fs.exists(path.join(projectDir, legacyName))).toBe(true);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writeTranscript replaces content atomically and leaves no temp file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-write-" });
        const filePath = path.join(root, `${SESSION_ID}.jsonl`);
        yield* fs.writeFileString(filePath, "before\n");

        yield* writeTranscript(filePath, FIXTURE_TEXT);

        expect(yield* fs.readFileString(filePath)).toBe(FIXTURE_TEXT);
        expect(yield* fs.readDirectory(root)).toEqual([`${SESSION_ID}.jsonl`]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("settle waits until two consecutive stats match and bounds retries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-transcript-settle-" });
        const filePath = path.join(root, `${SESSION_ID}.jsonl`);
        yield* fs.writeFileString(filePath, "initial\n");

        const stats: Array<{ readonly size: bigint; readonly mtimeMs: number }> = [
          { size: 10n, mtimeMs: 1000 },
          { size: 20n, mtimeMs: 2000 },
          { size: 20n, mtimeMs: 2000 },
          { size: 20n, mtimeMs: 2000 },
        ];
        const calls: Array<number> = [];
        const baseInfo = yield* fs.stat(filePath);
        const steppingFs = FileSystem.make({
          ...fs,
          stat: (target) => {
            if (target !== filePath) return fs.stat(target);
            const idx = Math.min(calls.length, stats.length - 1);
            calls.push(idx);
            const sample = stats[idx]!;
            return Effect.succeed({
              ...baseInfo,
              size: sample.size as FileSystem.File.Info["size"],
              mtime: Option.some(DateTime.toDateUtc(DateTime.makeUnsafe(sample.mtimeMs))),
            });
          },
        });

        const fiber = yield* settle(filePath, 400, 5).pipe(
          Effect.provideService(FileSystem.FileSystem, steppingFs),
          Effect.forkChild,
        );
        yield* TestClock.adjust("400 millis");
        yield* TestClock.adjust("400 millis");
        yield* Fiber.join(fiber);

        expect(calls).toHaveLength(4);

        const alwaysChangingCalls: Array<number> = [];
        const changingFs = FileSystem.make({
          ...fs,
          stat: (target) => {
            if (target !== filePath) return fs.stat(target);
            const n = alwaysChangingCalls.length + 1;
            alwaysChangingCalls.push(n);
            return Effect.succeed({
              ...baseInfo,
              size: BigInt(n) as FileSystem.File.Info["size"],
              mtime: Option.some(DateTime.toDateUtc(DateTime.makeUnsafe(n * 1000))),
            });
          },
        });

        const boundedFiber = yield* settle(filePath, 400, 3).pipe(
          Effect.provideService(FileSystem.FileSystem, changingFs),
          Effect.forkChild,
        );
        yield* TestClock.adjust("400 millis");
        yield* TestClock.adjust("400 millis");
        yield* TestClock.adjust("400 millis");
        yield* Fiber.join(boundedFiber);

        expect(alwaysChangingCalls).toHaveLength(6);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
