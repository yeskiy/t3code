import {
  ForkToolCallControlError,
  type ForkMoveToolCallToBackgroundInput,
  type ForkStopToolCallInput,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";

const isShellDynamicTool = (item: OrchestrationV2TurnItem) => {
  if (item.type !== "dynamic_tool" || item.toolName == null) return false;
  const normalized = item.toolName.toLowerCase().replaceAll(/[\s_-]/g, "");
  return normalized === "bash" || normalized === "powershell";
};

const isControllableToolCallItem = (item: OrchestrationV2TurnItem) =>
  item.type === "command_execution" || item.type === "subagent" || isShellDynamicTool(item);

export class ForkToolCallControl extends Context.Service<
  ForkToolCallControl,
  {
    readonly moveToBackground: (
      input: ForkMoveToolCallToBackgroundInput,
    ) => Effect.Effect<void, ForkToolCallControlError>;
    readonly stop: (input: ForkStopToolCallInput) => Effect.Effect<void, ForkToolCallControlError>;
  }
>()("t3/fork/ForkToolCallControl") {}

const make = Effect.gen(function* () {
  const threadDispatch = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;

  const makeFail =
    (input: {
      readonly threadId: ForkMoveToolCallToBackgroundInput["threadId"];
      readonly itemId: ForkMoveToolCallToBackgroundInput["itemId"];
    }) =>
    (reason: ForkToolCallControlError["reason"], cause?: unknown) =>
      new ForkToolCallControlError({
        threadId: input.threadId,
        itemId: input.itemId,
        reason,
        ...(cause === undefined ? {} : { cause }),
      });

  const resolveLiveTarget = Effect.fn("ForkToolCallControl.resolveLiveTarget")(function* (
    input: {
      readonly threadId: ForkMoveToolCallToBackgroundInput["threadId"];
      readonly itemId: ForkMoveToolCallToBackgroundInput["itemId"];
    },
    fail: ReturnType<typeof makeFail>,
  ) {
    const item = yield* orchestrator
      .getTurnItem({ threadId: input.threadId, itemId: input.itemId })
      .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
    if (item === null || item.threadId !== input.threadId || item.status !== "running") {
      return yield* fail("not-running");
    }
    if (!isControllableToolCallItem(item)) {
      return yield* fail("unsupported");
    }
    const records = yield* orchestrator
      .getThreadRecords(input.threadId, ["providerThreads"])
      .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
    if (records.thread.deletedAt !== null) return yield* fail("unavailable");
    const providerThread = records.providerThreads.find(
      (candidate) =>
        candidate.id === item.providerThreadId && candidate.appThreadId === input.threadId,
    );
    if (providerThread === undefined || providerThread.driver !== "claudeAgent") {
      return yield* fail("unsupported");
    }
    const nativeItemId = item.nativeItemRef?.nativeId;
    if (providerThread.providerSessionId == null || nativeItemId == null) {
      return yield* fail("unavailable");
    }
    const runtime = yield* sessions
      .get(providerThread.providerSessionId)
      .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
    if (Option.isNone(runtime)) return yield* fail("unavailable");
    return { providerThread, nativeItemId, runtime: runtime.value };
  });

  const moveToBackground = Effect.fn("ForkToolCallControl.moveToBackground")(
    function* (input: ForkMoveToolCallToBackgroundInput) {
      const fail = makeFail(input);
      const { providerThread, nativeItemId, runtime } = yield* resolveLiveTarget(input, fail);
      const move = runtime.moveToolCallToBackground;
      if (move === undefined) return yield* fail("unsupported");
      // Bounded so a provider that never answers cannot hold the thread lock.
      const moved = yield* move({ providerThread, nativeItemId }).pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) => fail("move-failed", cause)),
      );
      if (!moved) return yield* fail("not-running");
    },
    (effect, input) => threadDispatch.withLock(input.threadId, effect),
  );

  const stop = Effect.fn("ForkToolCallControl.stop")(
    function* (input: ForkStopToolCallInput) {
      const fail = makeFail(input);
      const { providerThread, nativeItemId, runtime } = yield* resolveLiveTarget(input, fail);
      const stopCall = runtime.stopToolCall;
      if (stopCall === undefined) return yield* fail("unsupported");
      // Bounded so a provider that never answers cannot hold the thread lock.
      const stopped = yield* stopCall({ providerThread, nativeItemId }).pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) => fail("stop-failed", cause)),
      );
      if (!stopped) return yield* fail("not-running");
    },
    (effect, input) => threadDispatch.withLock(input.threadId, effect),
  );

  return ForkToolCallControl.of({ moveToBackground, stop });
});

export const layer = Layer.effect(ForkToolCallControl, make).pipe(
  Layer.provide(ThreadCommandExecutor.layer),
);
