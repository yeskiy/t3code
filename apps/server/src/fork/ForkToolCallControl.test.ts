import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ForkToolCallControl from "./ForkToolCallControl.ts";

const threadId = ThreadId.make("thread-fork-tool-call");
const itemId = TurnItemId.make("item-fork-tool-call");
const providerThreadId = ProviderThreadId.make("provider-thread-fork-tool-call");
const providerSessionId = ProviderSessionId.make("provider-session-fork-tool-call");

const makeItem = (overrides: Partial<{ type: string; status: string; toolName: string }> = {}) =>
  ({
    id: itemId,
    threadId,
    providerThreadId,
    nativeItemRef: { driver: "claudeAgent", nativeId: "toolu_1", strength: "strong" },
    type: "command_execution",
    status: "running",
    ...overrides,
  }) as unknown as OrchestrationV2TurnItem;

const makeProviderThread = (driver = "claudeAgent") =>
  ({
    id: providerThreadId,
    appThreadId: threadId,
    driver: ProviderDriverKind.make(driver),
    providerSessionId,
    nativeThreadRef: { driver, nativeId: "native-session", strength: "strong" },
  }) as unknown as OrchestrationV2ProviderThread;

const run = (input: {
  readonly action?: "move" | "stop";
  readonly item?: OrchestrationV2TurnItem;
  readonly providerThread?: OrchestrationV2ProviderThread;
  readonly move?: ProviderAdapter.ProviderAdapterV2SessionRuntime["moveToolCallToBackground"];
  readonly stop?: ProviderAdapter.ProviderAdapterV2SessionRuntime["stopToolCall"];
}) => {
  const calls: Array<string> = [];
  const move = input.move;
  const stop = input.stop;
  const runtime = {
    ...(move === undefined
      ? {}
      : {
          moveToolCallToBackground: (args: Parameters<typeof move>[0]) =>
            Effect.sync(() => calls.push(args.nativeItemId)).pipe(Effect.andThen(move(args))),
        }),
    ...(stop === undefined
      ? {}
      : {
          stopToolCall: (args: Parameters<typeof stop>[0]) =>
            Effect.sync(() => calls.push(args.nativeItemId)).pipe(Effect.andThen(stop(args))),
        }),
  } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
  const layer = ForkToolCallControl.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getTurnItem: () => Effect.succeed(input.item ?? makeItem()),
          getThreadRecords: () =>
            Effect.succeed({
              thread: { deletedAt: null },
              providerThreads: [input.providerThread ?? makeProviderThread()],
            } as never),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          get: () => Effect.succeedSome(runtime),
        }),
      ),
    ),
  );
  return ForkToolCallControl.ForkToolCallControl.use((control) =>
    input.action === "stop"
      ? control.stop({ threadId, itemId })
      : control.moveToBackground({ threadId, itemId }),
  ).pipe(
    Effect.result,
    Effect.map((result) => ({ result, calls })),
    Effect.provide(layer),
  );
};

const reasonOf = (result: Effect.Success<ReturnType<typeof run>>["result"]) =>
  result._tag === "Failure" ? result.failure.reason : null;

describe("ForkToolCallControl.moveToBackground", () => {
  it.effect("moves a running Bash call", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({ move: () => Effect.succeed(true) });
      assert.equal(result._tag, "Success");
      assert.deepStrictEqual(calls, ["toolu_1"]);
    }),
  );

  it.effect("moves a running PowerShell dynamic_tool call", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        item: makeItem({ type: "dynamic_tool", toolName: "PowerShell" }),
        move: () => Effect.succeed(true),
      });
      assert.equal(result._tag, "Success");
      assert.deepStrictEqual(calls, ["toolu_1"]);
    }),
  );

  it.effect("refuses a finished item without a runtime call", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        item: makeItem({ status: "completed" }),
        move: () => Effect.succeed(true),
      });
      assert.equal(reasonOf(result), "not-running");
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("refuses an item type that cannot move", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        item: makeItem({ type: "file_change" }),
        move: () => Effect.succeed(true),
      });
      assert.equal(reasonOf(result), "unsupported");
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("refuses a provider thread that is not Claude", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        providerThread: makeProviderThread("codex"),
        move: () => Effect.succeed(true),
      });
      assert.equal(reasonOf(result), "unsupported");
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("refuses a runtime without the method", () =>
    Effect.gen(function* () {
      const { result } = yield* run({});
      assert.equal(reasonOf(result), "unsupported");
    }),
  );

  it.effect("reports not-running when the SDK finds no foreground task", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({ move: () => Effect.succeed(false) });
      assert.equal(reasonOf(result), "not-running");
      assert.deepStrictEqual(calls, ["toolu_1"]);
    }),
  );

  it.effect("reports move-failed when the runtime fails", () =>
    Effect.gen(function* () {
      const { result } = yield* run({
        move: () =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterProtocolError({
              driver: ProviderDriverKind.make("claudeAgent"),
              detail: "Background request failed",
            }),
          ),
      });
      assert.equal(reasonOf(result), "move-failed");
    }),
  );
});

describe("ForkToolCallControl.stop", () => {
  it.effect("stops a running command call", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        action: "stop",
        stop: () => Effect.succeed(true),
      });
      assert.equal(result._tag, "Success");
      assert.deepStrictEqual(calls, ["toolu_1"]);
    }),
  );

  it.effect("stops a running PowerShell dynamic_tool call", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        action: "stop",
        item: makeItem({ type: "dynamic_tool", toolName: "PowerShell" }),
        stop: () => Effect.succeed(true),
      });
      assert.equal(result._tag, "Success");
      assert.deepStrictEqual(calls, ["toolu_1"]);
    }),
  );

  it.effect("refuses a finished item without calling the runtime", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        action: "stop",
        item: makeItem({ status: "completed" }),
        stop: () => Effect.succeed(true),
      });
      assert.equal(reasonOf(result), "not-running");
      assert.deepStrictEqual(calls, []);
    }),
  );

  it.effect("refuses an unsupported item type or non-Claude provider", () =>
    Effect.gen(function* () {
      const badType = yield* run({
        action: "stop",
        item: makeItem({ type: "file_change" }),
        stop: () => Effect.succeed(true),
      });
      assert.equal(reasonOf(badType.result), "unsupported");
      assert.deepStrictEqual(badType.calls, []);

      const badDriver = yield* run({
        action: "stop",
        providerThread: makeProviderThread("codex"),
        stop: () => Effect.succeed(true),
      });
      assert.equal(reasonOf(badDriver.result), "unsupported");
      assert.deepStrictEqual(badDriver.calls, []);
    }),
  );

  it.effect("refuses a runtime without stopToolCall", () =>
    Effect.gen(function* () {
      const { result } = yield* run({ action: "stop" });
      assert.equal(reasonOf(result), "unsupported");
    }),
  );

  it.effect("reports not-running when the runtime finds no running task for the tool call", () =>
    Effect.gen(function* () {
      const { result, calls } = yield* run({
        action: "stop",
        stop: () => Effect.succeed(false),
      });
      assert.equal(reasonOf(result), "not-running");
      assert.deepStrictEqual(calls, ["toolu_1"]);
    }),
  );

  it.effect("reports stop-failed when the runtime fails", () =>
    Effect.gen(function* () {
      const { result } = yield* run({
        action: "stop",
        stop: () =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterProtocolError({
              driver: ProviderDriverKind.make("claudeAgent"),
              detail: "Stop tool call request failed",
            }),
          ),
      });
      assert.equal(reasonOf(result), "stop-failed");
    }),
  );
});
