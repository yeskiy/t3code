import {
  ForkToolCallControlError,
  type ForkMoveToolCallToBackgroundInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";

export class ForkToolCallControl extends Context.Service<
  ForkToolCallControl,
  {
    readonly moveToBackground: (
      input: ForkMoveToolCallToBackgroundInput,
    ) => Effect.Effect<void, ForkToolCallControlError>;
  }
>()("t3/fork/ForkToolCallControl") {}

const make = Effect.gen(function* () {
  const threadDispatch = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;

  const moveToBackground = Effect.fn("ForkToolCallControl.moveToBackground")(
    function* (input: ForkMoveToolCallToBackgroundInput) {
      const fail = (reason: ForkToolCallControlError["reason"], cause?: unknown) =>
        new ForkToolCallControlError({
          threadId: input.threadId,
          itemId: input.itemId,
          reason,
          ...(cause === undefined ? {} : { cause }),
        });
      const item = yield* orchestrator
        .getTurnItem({ threadId: input.threadId, itemId: input.itemId })
        .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
      if (item === null || item.threadId !== input.threadId || item.status !== "running") {
        return yield* fail("not-running");
      }
      if (item.type !== "command_execution" && item.type !== "subagent") {
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
      const move = runtime.value.moveToolCallToBackground;
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

  return ForkToolCallControl.of({ moveToBackground });
});

export const layer = Layer.effect(ForkToolCallControl, make).pipe(
  Layer.provide(ThreadCommandExecutor.layer),
);
