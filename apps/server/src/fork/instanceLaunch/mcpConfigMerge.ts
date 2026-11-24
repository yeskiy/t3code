import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const T3_MCP_SERVER_NAME = "t3-code";
const decodeJsonUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodePrettyJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

export class ForkMcpConfigError extends Schema.TaggedError<ForkMcpConfigError>()(
  "ForkMcpConfigError",
  { path: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `MCP config file ${this.path} ${this.reason}.`;
  }
}

export const parseMcpConfigFileList = (text: string): ReadonlyArray<string> =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

const serversOf = (document: { readonly path: string; readonly json: unknown }) => {
  const servers = (document.json as { readonly mcpServers?: unknown } | null)?.mcpServers;
  return typeof servers === "object" && servers !== null && !Array.isArray(servers)
    ? Effect.succeed(servers as Record<string, unknown>)
    : Effect.fail(
        new ForkMcpConfigError({ path: document.path, reason: "has no mcpServers object" }),
      );
};

export const mergeMcpServers = (
  documents: ReadonlyArray<{ readonly path: string; readonly json: unknown }>,
) =>
  Effect.forEach(documents, serversOf).pipe(
    Effect.map((list) =>
      Object.fromEntries(
        list.flatMap((servers) =>
          Object.entries(servers).filter(([name]) => name !== T3_MCP_SERVER_NAME),
        ),
      ),
    ),
  );

/** Writes the merged file only when its content changes, and returns its path. */
export const writeMergedMcpConfig = Effect.fn("fork.writeMergedMcpConfig")(function* (input: {
  readonly files: ReadonlyArray<string>;
  readonly homeDirectory: string;
  readonly outputPath: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const documents = yield* Effect.forEach(input.files, (file) => {
    const filePath = path.resolve(input.homeDirectory, expandHomePath(file, input.homeDirectory));
    return fileSystem.readFileString(filePath).pipe(
      Effect.mapError(
        () => new ForkMcpConfigError({ path: filePath, reason: "is missing or cannot be read" }),
      ),
      Effect.flatMap((text) =>
        decodeJsonUnknown(text).pipe(
          Effect.map((json) => ({ path: filePath, json })),
          Effect.mapError(
            () => new ForkMcpConfigError({ path: filePath, reason: "is not valid JSON" }),
          ),
        ),
      ),
    );
  });
  const encoded = yield* encodePrettyJson({ mcpServers: yield* mergeMcpServers(documents) }).pipe(
    Effect.mapError(
      () => new ForkMcpConfigError({ path: input.outputPath, reason: "cannot be written" }),
    ),
  );
  const contents = `${encoded}\n`;
  const current = yield* fileSystem
    .readFileString(input.outputPath)
    .pipe(Effect.orElseSucceed(() => ""));
  if (current !== contents) {
    yield* fileSystem.makeDirectory(path.dirname(input.outputPath), { recursive: true }).pipe(
      Effect.andThen(writeFileStringAtomically({ filePath: input.outputPath, contents })),
      Effect.mapError(
        () => new ForkMcpConfigError({ path: input.outputPath, reason: "cannot be written" }),
      ),
    );
  }
  return input.outputPath;
});
