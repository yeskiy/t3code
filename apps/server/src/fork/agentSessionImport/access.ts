import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ForkDelegationAgents } from "../delegationAgents/ForkDelegationAgents.ts";

const denied = (message: string) =>
  new OrchestratorMcpFailure({ code: "capability_denied", message });

// Work and personal sessions never cross: a caller reads only its own instance's sessions.
export const forkSessionInstance = <Id extends string>(requested: Id | undefined, caller: Id) =>
  requested === undefined || requested === caller
    ? Effect.succeed(caller)
    : Effect.fail(
        denied(
          `This thread runs on instance ${caller}, so it can list and import only that instance's sessions.`,
        ),
      );

/** A read-only delegation agent may list sessions but never import them. */
export const forkAssertMayImportSessions = Effect.fn("fork.agentSessionImport.assertMayImport")(
  function* (input: {
    readonly agents: ForkDelegationAgents["Service"];
    readonly callerThreadId: ThreadId;
  }) {
    const agent = yield* input.agents
      .forThread(input.callerThreadId)
      .pipe(
        Effect.mapError(() =>
          denied("The agent of this thread cannot be read, so the import is refused."),
        ),
      );
    if (agent?.limits.includes("read-only") === true) {
      return yield* denied(
        "A read-only agent cannot import sessions. It can list them with t3_session_import_list.",
      );
    }
  },
);
