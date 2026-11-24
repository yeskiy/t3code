import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { mergeMcpServers, parseMcpConfigFileList, writeMergedMcpConfig } from "./mcpConfigMerge.ts";

describe("parseMcpConfigFileList", () => {
  it("keeps one trimmed path per line and drops blank and # lines", () => {
    expect(parseMcpConfigFileList("  a.json \r\n\n# note\nb.json")).toEqual(["a.json", "b.json"]);
  });
});

describe("mergeMcpServers", () => {
  it.effect("merges in order, a later file wins, and drops t3-code", () =>
    Effect.gen(function* () {
      const merged = yield* mergeMcpServers([
        { path: "common.json", json: { mcpServers: { a: { command: "1" }, "t3-code": {} } } },
        { path: "work.json", json: { mcpServers: { a: { command: "2" }, b: { command: "3" } } } },
      ]);
      expect(merged).toEqual({ a: { command: "2" }, b: { command: "3" } });
    }),
  );

  it.effect("fails with the path when a file has no mcpServers object", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        mergeMcpServers([{ path: "bad.json", json: { servers: {} } }]),
      );
      expect(error.message).toBe("MCP config file bad.json has no mcpServers object.");
    }),
  );
});

describe("writeMergedMcpConfig", () => {
  it.effect("writes merged servers from fixture files and skips rewriting identical output", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-mcp-merge-" });
        const first = path.join(dir, "common.json");
        const second = path.join(dir, "work.json");
        const output = path.join(dir, "fork", "mcp", "claudeWork.json");
        yield* fs.writeFileString(
          first,
          JSON.stringify({ mcpServers: { alpha: { command: "a1" }, "t3-code": { url: "x" } } }),
        );
        yield* fs.writeFileString(
          second,
          JSON.stringify({ mcpServers: { alpha: { command: "a2" }, beta: { command: "b1" } } }),
        );

        const written = yield* writeMergedMcpConfig({
          files: ["~/common.json", second],
          homeDirectory: dir,
          outputPath: output,
        });
        expect(written).toBe(output);
        expect(JSON.parse(yield* fs.readFileString(output))).toEqual({
          mcpServers: { alpha: { command: "a2" }, beta: { command: "b1" } },
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with the resolved path when a fixture file is missing or invalid JSON", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-mcp-err-" });
        const missing = path.join(dir, "missing.json");
        const broken = path.join(dir, "broken.json");
        yield* fs.writeFileString(broken, "{not json");

        const missingError = yield* Effect.flip(
          writeMergedMcpConfig({
            files: [missing],
            homeDirectory: dir,
            outputPath: path.join(dir, "out.json"),
          }),
        );
        expect(missingError.message).toContain(missing);
        expect(missingError.message).toContain("is missing or cannot be read");

        const brokenError = yield* Effect.flip(
          writeMergedMcpConfig({
            files: [broken],
            homeDirectory: dir,
            outputPath: path.join(dir, "out.json"),
          }),
        );
        expect(brokenError.message).toContain(broken);
        expect(brokenError.message).toContain("is not valid JSON");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
