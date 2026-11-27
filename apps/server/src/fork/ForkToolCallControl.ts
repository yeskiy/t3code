import {
  ForkBackgroundTaskStopError,
  ForkToolCallControlError,
  type ForkMoveToolCallToBackgroundInput,
  type ForkStopBackgroundTaskInput,
  type ForkStopToolCallInput,
  isProviderNativeSubagentThread,
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
    readonly stopBackgroundTask: (
      input: ForkStopBackgroundTaskInput,
    ) => Effect.Effect<void, ForkBackgroundTaskStopError>;
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

  const findOwnerClaudeProviderThread = Effect.fn(
    "ForkToolCallControl.findOwnerClaudeProviderThread",
  )(function* (
    ownerThreadId: ForkMoveToolCallToBackgroundInput["threadId"],
    fail: ReturnType<typeof makeFail>,
  ) {
    const ownerRecords = yield* orchestrator
      .getThreadRecords(ownerThreadId, ["providerThreads"])
      .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
    if (ownerRecords.thread.deletedAt !== null) return yield* fail("unavailable");
    const active = ownerRecords.providerThreads.find(
      (candidate) =>
        candidate.id === ownerRecords.thread.activeProviderThreadId &&
        candidate.appThreadId === ownerThreadId &&
        candidate.driver === "claudeAgent",
    );
    return (
      active ??
      ownerRecords.providerThreads.findLast(
        (candidate) =>
          candidate.appThreadId === ownerThreadId &&
          candidate.driver === "claudeAgent" &&
          candidate.providerSessionId !== null,
      )
    );
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
    // Native Claude subagent child threads share their root thread's Claude session.
    const providerThread =
      item.providerThreadId !== null
        ? records.providerThreads.find(
            (candidate) =>
              candidate.id === item.providerThreadId && candidate.appThreadId === input.threadId,
          )
        : isProviderNativeSubagentThread(records.thread) &&
            records.thread.lineage.rootThreadId !== input.threadId
          ? yield* findOwnerClaudeProviderThread(records.thread.lineage.rootThreadId, fail)
          : undefined;
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
    return { item, providerThread, nativeItemId, runtime: runtime.value };
  });

  const moveToBackground = Effect.fn("ForkToolCallControl.moveToBackground")(
    function* (input: ForkMoveToolCallToBackgroundInput) {
      const fail = makeFail(input);
      const { item, providerThread, nativeItemId, runtime } = yield* resolveLiveTarget(input, fail);
      if (item.type === "subagent" && item.backgrounded === true) {
        return yield* fail("not-running");
      }
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

  // Stops one task from a Claude provider thread's roster, which has no running turn item.
  const stopBackgroundTask = Effect.fn("ForkToolCallControl.stopBackgroundTask")(
    function* (input: ForkStopBackgroundTaskInput) {
      const fail = (reason: ForkBackgroundTaskStopError["reason"], cause?: unknown) =>
        new ForkBackgroundTaskStopError({
          threadId: input.threadId,
          taskId: input.taskId,
          reason,
          ...(cause === undefined ? {} : { cause }),
        });
      const records = yield* orchestrator
        .getThreadRecords(input.threadId, ["providerThreads"])
        .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
      if (records.thread.deletedAt !== null) return yield* fail("unavailable");
      const providerThread = records.providerThreads.find(
        (candidate) =>
          candidate.appThreadId === input.threadId &&
          (candidate.pendingBackgroundTasks ?? []).some(
            (task) => task.taskId === input.taskId && task.kind !== "subagent",
          ),
      );
      if (providerThread === undefined) return yield* fail("not-running");
      if (providerThread.driver !== "claudeAgent") return yield* fail("unsupported");
      if (providerThread.providerSessionId == null) return yield* fail("unavailable");
      const runtime = yield* sessions
        .get(providerThread.providerSessionId)
        .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
      if (Option.isNone(runtime)) return yield* fail("unavailable");
      const stopCall = runtime.value.stopToolCall;
      if (stopCall === undefined) return yield* fail("unsupported");
      // Bounded so a provider that never answers cannot hold the thread lock.
      const stopped = yield* stopCall({ providerThread, nativeItemId: input.taskId }).pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) => fail("stop-failed", cause)),
      );
      if (!stopped) return yield* fail("not-running");
    },
    (effect, input) => threadDispatch.withLock(input.threadId, effect),
  );

  return ForkToolCallControl.of({ moveToBackground, stop, stopBackgroundTask });
});

export const layer = Layer.effect(ForkToolCallControl, make).pipe(
  Layer.provide(ThreadCommandExecutor.layer),
);
