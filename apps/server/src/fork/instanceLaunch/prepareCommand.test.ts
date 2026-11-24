import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { outputTail, runPrepareCommand } from "./prepareCommand.ts";

const node = JSON.stringify(process.execPath);
const run = (script: string, timeout = Duration.seconds(20)) =>
  runPrepareCommand({
    command: `${node} -e ${JSON.stringify(script)}`,
    cwd: process.cwd(),
    environment: { ...process.env, FORK_PREPARE_TEST: "ready" },
    timeout,
  });

describe("runPrepareCommand", () => {
  it.live("succeeds on exit code 0 and gets the instance environment", () =>
    run("process.exit(process.env.FORK_PREPARE_TEST === 'ready' ? 0 : 5)").pipe(
      Effect.provide(NodeServices.layer),
    ),
  );

  it.live("fails with the exit code and the output tail", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run("console.log('one'); console.error('two'); process.exit(3)"),
      );
      expect(error.reason).toBe("exit");
      expect(error.exitCode).toBe(3);
      expect(error.message).toContain("two");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("fails with reason timeout", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run("setTimeout(() => {}, 60000)", Duration.millis(500)));
      expect(error.reason).toBe("timeout");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("outputTail", () => {
  it("keeps the last 20 lines", () => {
    const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\r\n");
    expect(outputTail(text).split("\n")).toHaveLength(20);
    expect(outputTail(text).startsWith("line 10")).toBe(true);
  });

  it("keeps at most 4096 bytes", () => {
    expect(Buffer.byteLength(outputTail("x".repeat(10_000)))).toBe(4096);
  });
});
