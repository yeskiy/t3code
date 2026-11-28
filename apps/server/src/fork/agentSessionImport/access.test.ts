import { describe, expect, it } from "@effect/vitest";
import { type ForkAgentLimit, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ForkDelegationAgents } from "../delegationAgents/ForkDelegationAgents.ts";
import { forkAssertMayImportSessions, forkSessionInstance } from "./access.ts";

const agentsWith = (limits: ReadonlyArray<ForkAgentLimit> | undefined) =>
  ForkDelegationAgents.of({
    list: Effect.succeed([]),
    resolveForTask: () => Effect.undefined,
    record: () => Effect.void,
    forThread: () =>
      Effect.succeed(
        limits === undefined ? undefined : { name: "agent", limits, instructions: "" },
      ),
    describe: () => Effect.succeed([]),
  });

const callerThreadId = ThreadId.make("caller");

describe("forkAssertMayImportSessions", () => {
  it.effect("refuses a read-only agent", () =>
    Effect.gen(function* () {
      const error = yield* forkAssertMayImportSessions({
        agents: agentsWith(["read-only"]),
        callerThreadId,
      }).pipe(Effect.flip);
      expect(error.code).toBe("capability_denied");
      expect(error.message).toBe(
        "A read-only agent cannot import sessions. It can list them with t3_session_import_list.",
      );
    }),
  );

  it.effect("allows a thread without an agent and an agent without read-only", () =>
    Effect.gen(function* () {
      yield* forkAssertMayImportSessions({ agents: agentsWith(undefined), callerThreadId });
      yield* forkAssertMayImportSessions({
        agents: agentsWith(["no-delegation"]),
        callerThreadId,
      });
    }),
  );
});

describe("forkSessionInstance", () => {
  it.effect("keeps the caller's instance and refuses another one", () =>
    Effect.gen(function* () {
      expect(yield* forkSessionInstance(undefined, "claudeAgent")).toBe("claudeAgent");
      expect(yield* forkSessionInstance("claudeWork", "claudeWork")).toBe("claudeWork");
      const error = yield* forkSessionInstance("claudeWork", "claudeAgent").pipe(Effect.flip);
      expect(error.code).toBe("capability_denied");
    }),
  );
});
