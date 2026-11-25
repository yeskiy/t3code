import * as NodeServices from "@effect/platform-node/NodeServices";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Schema from "effect/Schema";

import { FIXTURE_TEXT } from "./core/fixtures.ts";
import { parseJsonl, serializeJsonl } from "./core/jsonl.ts";
import { applyOp } from "./core/ops.ts";

const SESSION_ID = "4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b";

const decodeMessages = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ type: Schema.String, uuid: Schema.String }))),
);

it.live("the Claude history worker reads an edited session in the edited order", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-transcript-sdk-" });
    const filePath = path.join(configDir, "projects", "x", `${SESSION_ID}.jsonl`);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(
      filePath,
      serializeJsonl(applyOp(parseJsonl(FIXTURE_TEXT), { kind: "deleteUnit", unit: "a3" })),
    );
    const worker = path.join(import.meta.dirname, "..", "..", "claude-history-worker.ts");
    const result = yield* spawnAndCollect(
      process.execPath,
      ChildProcess.make(
        process.execPath,
        ["--experimental-strip-types", worker, "getSessionMessages", SESSION_ID, "{}"],
        { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } },
      ),
      { maxStdoutBytes: Number.POSITIVE_INFINITY },
    );
    assert.equal(result.code, 0, result.stderr);
    const uuids = decodeMessages(result.stdout)
      .filter((entry) => entry.type === "user" || entry.type === "assistant")
      .map((entry) => entry.uuid);
    assert.deepEqual(uuids, ["u1", "a1t", "a1", "a2", "r1", "u2", "a4"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
