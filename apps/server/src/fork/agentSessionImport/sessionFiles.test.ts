// @effect-diagnostics nodeBuiltinImport:off - FileSystem cannot create a directory junction.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  copySession,
  listSessionFiles,
  replaceSessionId,
  resolveSessionFile,
} from "./sessionFiles.ts";

const SESSION_ID = "702769fb-1111-4222-8333-444455556666";
const NEW_ID = "af739ca7-aaaa-4bbb-8ccc-ddddeeeeffff";

const sessionText = (id: string) =>
  [
    JSON.stringify({ type: "user", sessionId: id, cwd: "/repo", message: { content: "Fix it" } }),
    JSON.stringify({ type: "assistant", sessionId: id, message: { content: "Done" } }),
    JSON.stringify({ type: "system", payload: { session_id: id } }),
    "",
  ].join("\n");

const makeHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "fork-session-import-" });
  const folder = path.join(home, "projects", "-repo");
  yield* fs.makeDirectory(folder, { recursive: true });
  const filePath = path.join(folder, `${SESSION_ID}.jsonl`);
  yield* fs.writeFileString(filePath, sessionText(SESSION_ID));
  return { home, folder, filePath };
});

describe("sessionFiles", () => {
  it("replaceSessionId changes every sessionId and session_id field and nothing else", () => {
    const replaced = replaceSessionId(
      `${sessionText(SESSION_ID)}{"note":"${SESSION_ID}"}\n`,
      SESSION_ID,
      NEW_ID,
    );
    const lines = replaced.trim().split("\n");
    expect(lines.slice(0, 2).map((line) => JSON.parse(line).sessionId)).toEqual([NEW_ID, NEW_ID]);
    expect(JSON.parse(lines[2]!).payload.session_id).toBe(NEW_ID);
    expect(JSON.parse(lines[3]!).note).toBe(SESSION_ID);
  });

  it.effect("resolveSessionFile finds a session inside the projects folder", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { home, filePath } = yield* makeHome;
        const found = yield* resolveSessionFile({ configDir: home, sessionId: SESSION_ID });
        expect(found?.filePath).toBe(filePath);
        expect(found?.sessionId).toBe(SESSION_ID);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("resolveSessionFile refuses an id that is not a UUID", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { home } = yield* makeHome;
        const error = yield* resolveSessionFile({
          configDir: home,
          sessionId: "../../outside",
        }).pipe(Effect.flip);
        expect(error.message).toBe("The session id must be a UUID.");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("resolveSessionFile and listSessionFiles skip a folder link that leaves projects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home } = yield* makeHome;
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "fork-session-outside-" });
        const outsideId = "11111111-2222-4333-8444-555555555555";
        yield* fs.writeFileString(path.join(outside, `${outsideId}.jsonl`), sessionText(outsideId));
        NodeFS.symlinkSync(outside, path.join(home, "projects", "-escape"), "junction");

        expect(yield* resolveSessionFile({ configDir: home, sessionId: outsideId })).toBeNull();
        const listed = yield* listSessionFiles(home);
        expect(listed.map((file) => file.sessionId)).toEqual([SESSION_ID]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("copySession writes a new id in every line and keeps the original", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { home, filePath, folder } = yield* makeHome;
        const file = yield* resolveSessionFile({ configDir: home, sessionId: SESSION_ID });
        const copy = yield* copySession({ file: file!, newSessionId: NEW_ID, title: "Serein" });

        expect(copy.sessionId).toBe(NEW_ID);
        expect(copy.folder).toBe(folder);
        expect(yield* fs.readFileString(filePath)).toBe(sessionText(SESSION_ID));
        const lines = (yield* fs.readFileString(copy.filePath)).trim().split("\n");
        expect(lines.join("\n")).not.toContain(SESSION_ID);
        expect(JSON.parse(lines.at(-1)!)).toEqual({
          type: "custom-title",
          customTitle: "Serein",
          sessionId: NEW_ID,
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("copySession never overwrites an existing file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { home, folder } = yield* makeHome;
        const taken = path.join(folder, `${NEW_ID}.jsonl`);
        yield* fs.writeFileString(taken, "keep me\n");
        const file = yield* resolveSessionFile({ configDir: home, sessionId: SESSION_ID });
        const error = yield* copySession({ file: file!, newSessionId: NEW_ID }).pipe(Effect.flip);

        expect(error.message).toBe(`A session file named ${NEW_ID}.jsonl already exists.`);
        expect(yield* fs.readFileString(taken)).toBe("keep me\n");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
