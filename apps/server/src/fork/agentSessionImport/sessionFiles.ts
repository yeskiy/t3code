import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SESSION_FILE_SUFFIX = ".jsonl";
const encodeTitleRecord = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("custom-title"),
      customTitle: Schema.String,
      sessionId: Schema.String,
    }),
  ),
);

export class ForkSessionImportError extends Schema.TaggedError<ForkSessionImportError>()(
  "ForkSessionImportError",
  { message: Schema.String },
) {}

const refuse = (message: string) => new ForkSessionImportError({ message });

/** A Claude session file that sits, after links resolve, inside its `projects` folder. */
export interface SessionFile {
  readonly sessionId: string;
  readonly folder: string;
  readonly filePath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

const isSessionFileName = (name: string): boolean =>
  name.endsWith(SESSION_FILE_SUFFIX) &&
  SESSION_ID_PATTERN.test(name.slice(0, -SESSION_FILE_SUFFIX.length));

const isInside = (path: Path.Path, root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== "" && !path.isAbsolute(relative) && relative.split(/[\\/]/)[0] !== "..";
};

const sessionFilesIn = Effect.fn("fork.agentSessionImport.sessionFilesIn")(function* (
  configDir: string,
  sessionId?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectsDir = path.join(configDir, "projects");
  const realProjects = yield* fs.realPath(projectsDir).pipe(Effect.option);
  if (Option.isNone(realProjects)) return [];
  const statInside = (folder: string, name: string) => {
    const filePath = path.join(folder, name);
    return fs.realPath(filePath).pipe(
      Effect.flatMap((real) =>
        isInside(path, realProjects.value, real)
          ? Effect.map(fs.stat(real), (info): ReadonlyArray<SessionFile> =>
              info.type === "File"
                ? [
                    {
                      sessionId: name.slice(0, -SESSION_FILE_SUFFIX.length),
                      folder,
                      filePath,
                      size: Number(info.size),
                      mtimeMs: Option.getOrUndefined(info.mtime)?.getTime() ?? 0,
                    },
                  ]
                : [],
            )
          : Effect.succeed([]),
      ),
      Effect.orElseSucceed((): ReadonlyArray<SessionFile> => []),
    );
  };
  const folders = yield* fs
    .readDirectory(projectsDir)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const found = yield* Effect.forEach(
    folders,
    (folderName) => {
      const folder = path.join(projectsDir, folderName);
      const names =
        sessionId === undefined
          ? fs.readDirectory(folder).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
          : Effect.succeed([`${sessionId}${SESSION_FILE_SUFFIX}`]);
      return Effect.flatMap(names, (entries) =>
        Effect.forEach(entries.filter(isSessionFileName), (name) => statInside(folder, name)),
      );
    },
    { concurrency: 8 },
  );
  return found.flat(2);
});

const newestFirst = (configDir: string, sessionId?: string) =>
  Effect.map(sessionFilesIn(configDir, sessionId), (files) =>
    files.toSorted((left, right) => right.mtimeMs - left.mtimeMs),
  );

/** Every session file of a Claude config folder, newest first. */
export const listSessionFiles = (configDir: string) => newestFirst(configDir);

/** The newest file of one session, or null when no `projects` folder holds it. */
export const resolveSessionFile = Effect.fn("fork.agentSessionImport.resolveSessionFile")(
  function* (input: { readonly configDir: string; readonly sessionId: string }) {
    if (!SESSION_ID_PATTERN.test(input.sessionId)) {
      return yield* refuse("The session id must be a UUID.");
    }
    return (yield* newestFirst(input.configDir, input.sessionId))[0] ?? null;
  },
);

export const replaceSessionId = (text: string, oldId: string, newId: string): string =>
  text.replace(
    new RegExp(
      `("(?:sessionId|session_id)"\\s*:\\s*")${oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(")`,
      "g",
    ),
    `$1${newId}$2`,
  );

/** Copies a session under a new id in the same folder. It never writes over a file. */
export const copySession = Effect.fn("fork.agentSessionImport.copySession")(function* (input: {
  readonly file: SessionFile;
  readonly newSessionId: string;
  readonly title?: string | undefined;
}) {
  if (!SESSION_ID_PATTERN.test(input.newSessionId)) {
    return yield* refuse("The new session id must be a UUID.");
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const name = `${input.newSessionId}${SESSION_FILE_SUFFIX}`;
  const filePath = path.join(input.file.folder, name);
  const exists = refuse(`A session file named ${name} already exists.`);
  if (yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => true))) return yield* exists;
  const text = yield* fs
    .readFileString(input.file.filePath)
    .pipe(Effect.mapError(() => refuse("The session file cannot be read.")));
  const copied = replaceSessionId(text, input.file.sessionId, input.newSessionId);
  const title = input.title?.trim();
  const contents =
    title === undefined || title === ""
      ? copied
      : `${copied}${copied === "" || copied.endsWith("\n") ? "" : "\n"}${encodeTitleRecord({
          type: "custom-title",
          customTitle: title,
          sessionId: input.newSessionId,
        })}\n`;
  yield* fs
    .writeFileString(filePath, contents, { flag: "wx" })
    .pipe(
      Effect.mapError((error) =>
        error.reason._tag === "AlreadyExists" ? exists : refuse("The copy cannot be written."),
      ),
    );
  const info = yield* fs.stat(filePath).pipe(Effect.option);
  return {
    sessionId: input.newSessionId,
    folder: input.file.folder,
    filePath,
    size: Option.match(info, { onNone: () => 0, onSome: (value) => Number(value.size) }),
    mtimeMs: Option.match(info, {
      onNone: () => 0,
      onSome: (value) => Option.getOrUndefined(value.mtime)?.getTime() ?? 0,
    }),
  } satisfies SessionFile;
});
