import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2ProviderThread,
  ProviderDriverKind,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";

import * as ForkStopScope from "./ForkStopScope.ts";

const makeProviderThread = (providerSessionId: ProviderSessionId | null) =>
  ({
    id: ProviderThreadId.make("provider-thread-stop-scope"),
    appThreadId: ThreadId.make("thread-stop-scope"),
    driver: ProviderDriverKind.make("claudeAgent"),
    providerSessionId,
  }) as unknown as OrchestrationV2ProviderThread;

describe("ForkStopScope", () => {
  it("keeps background work only for turn-scoped Stop on an active run", () => {
    assert.isTrue(ForkStopScope.runCanKeepBackgroundWork({ status: "preparing" }, "turn"));
    assert.isTrue(ForkStopScope.runCanKeepBackgroundWork({ status: "starting" }, "turn"));
    assert.isTrue(ForkStopScope.runCanKeepBackgroundWork({ status: "running" }, "turn"));
    assert.isFalse(ForkStopScope.runCanKeepBackgroundWork({ status: "completed" }, "turn"));
    assert.isFalse(ForkStopScope.runCanKeepBackgroundWork({ status: "waiting" }, "turn"));
    assert.isFalse(ForkStopScope.runCanKeepBackgroundWork({ status: "interrupted" }, "turn"));
    assert.isFalse(ForkStopScope.runCanKeepBackgroundWork({ status: "running" }, "all"));
    assert.isFalse(ForkStopScope.runCanKeepBackgroundWork({ status: "running" }, undefined));
    assert.isFalse(ForkStopScope.runCanKeepBackgroundWork(undefined, "turn"));
  });

  it("identifies terminals whose background work continues", () => {
    assert.isTrue(
      ForkStopScope.terminalKeepsBackgroundWork({
        status: "interrupted",
        backgroundWorkContinues: true,
      }),
    );
    assert.isFalse(ForkStopScope.terminalKeepsBackgroundWork({ status: "interrupted" }));
    assert.isFalse(
      ForkStopScope.terminalKeepsBackgroundWork({
        status: "failed",
        backgroundWorkContinues: true,
      }),
    );
    assert.isFalse(
      ForkStopScope.terminalKeepsBackgroundWork({
        status: "completed",
        backgroundWorkContinues: true,
      }),
    );
  });

  it.effect("probes live sessions with includeSubagents for turn-scoped settle", () =>
    Effect.gen(function* () {
      const seenOptions: Array<{ readonly includeSubagents?: boolean } | undefined> = [];
      const sessionId = ProviderSessionId.make("session-stop-scope");
      const thread = makeProviderThread(sessionId);
      const runtime = {
        providerSession: {
          capabilities: { turns: { interruptKeepsBackgroundWork: true } },
        },
        hasPendingBackgroundWorkForThread: (
          _thread: OrchestrationV2ProviderThread,
          options?: { readonly includeSubagents?: boolean },
        ) =>
          Effect.sync(() => {
            seenOptions.push(options);
            return true;
          }),
      } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;

      const preserved = yield* ForkStopScope.shouldPreserveProviderBackgroundWork({
        scope: "turn",
        providerThread: thread,
        getSession: () => Effect.succeedSome(runtime),
      });

      assert.isTrue(preserved);
      assert.deepStrictEqual(seenOptions, [{ includeSubagents: true }]);
    }),
  );

  it.effect("returns false when scope is omitted or the provider cannot keep background work", () =>
    Effect.gen(function* () {
      const sessionId = ProviderSessionId.make("session-stop-scope-no-cap");
      const thread = makeProviderThread(sessionId);
      const runtime = {
        providerSession: {
          capabilities: { turns: { interruptKeepsBackgroundWork: false } },
        },
        hasPendingBackgroundWorkForThread: () => Effect.succeed(true),
      } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;

      assert.isFalse(
        yield* ForkStopScope.shouldPreserveProviderBackgroundWork({
          scope: undefined,
          providerThread: thread,
          getSession: () => Effect.succeedSome(runtime),
        }),
      );
      assert.isFalse(
        yield* ForkStopScope.shouldPreserveProviderBackgroundWork({
          scope: "turn",
          providerThread: thread,
          getSession: () => Effect.succeedSome(runtime),
        }),
      );
      assert.isFalse(
        yield* ForkStopScope.shouldPreserveProviderBackgroundWork({
          scope: "turn",
          providerThread: makeProviderThread(null),
          getSession: () => Effect.succeedNone,
        }),
      );
    }),
  );
});
