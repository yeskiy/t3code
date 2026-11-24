import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const FORK_PREPARE_TIMEOUT = Duration.seconds(120);
const TAIL_LINES = 20;
const TAIL_MAX_BYTES = 4096;

export class ForkPrepareCommandError extends Schema.TaggedError<ForkPrepareCommandError>()(
  "ForkPrepareCommandError",
  {
    reason: Schema.Literals(["exit", "timeout", "spawn"]),
    exitCode: Schema.optional(Schema.Number),
    outputTail: Schema.String,
  },
) {
  override get message(): string {
    const head =
      this.reason === "timeout"
        ? "The prepare command did not finish in 120 s."
        : this.reason === "spawn"
          ? "The prepare command did not start."
          : `The prepare command failed with exit code ${this.exitCode}.`;
    return this.outputTail === "" ? head : `${head}\n${this.outputTail}`;
  }
}

/** The last 20 lines of the output, at most 4 KB, so a failed turn shows the reason. */
export const outputTail = (text: string): string => {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
  const bytes = Buffer.from(lines, "utf8");
  return bytes.length <= TAIL_MAX_BYTES
    ? lines
    : bytes.subarray(bytes.length - TAIL_MAX_BYTES).toString("utf8");
};

export const runPrepareCommand = Effect.fn("fork.runPrepareCommand")(function* (input: {
  readonly command: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly timeout?: Duration.Duration;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const startedAt = yield* Clock.currentTimeMillis;
  const outcome = yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(input.command, [], {
          shell: true,
          cwd: input.cwd,
          env: input.environment,
          extendEnv: false,
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const output = yield* Stream.merge(child.stdout, child.stderr).pipe(
        Stream.decodeText(),
        Stream.mkString,
      );
      return { exitCode: Number(yield* child.exitCode), output };
    }),
  ).pipe(
    Effect.mapError(() => new ForkPrepareCommandError({ reason: "spawn", outputTail: "" })),
    Effect.timeoutOption(input.timeout ?? FORK_PREPARE_TIMEOUT),
  );
  yield* Effect.logInfo("fork prepare command finished", {
    exitCode: Option.isSome(outcome) ? outcome.value.exitCode : null,
    durationMs: (yield* Clock.currentTimeMillis) - startedAt,
  });
  if (Option.isNone(outcome)) {
    return yield* new ForkPrepareCommandError({ reason: "timeout", outputTail: "" });
  }
  if (outcome.value.exitCode !== 0) {
    return yield* new ForkPrepareCommandError({
      reason: "exit",
      exitCode: outcome.value.exitCode,
      outputTail: outputTail(outcome.value.output),
    });
  }
});
