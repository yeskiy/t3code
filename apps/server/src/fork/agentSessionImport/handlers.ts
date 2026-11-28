import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkDelegationAgents } from "../delegationAgents/ForkDelegationAgents.ts";
import { forkAssertMayImportSessions, forkSessionInstance } from "./access.ts";
import { ForkAgentSessionImport } from "./ForkAgentSessionImport.ts";
import { ForkAgentSessionImportToolkit } from "./tools.ts";

const callerScope = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "This tool")),
);

export const layer = McpToolAccess.toLayer(ForkAgentSessionImportToolkit, {
  t3_session_import_list: McpToolAccess.readsAsCaller(({ providerInstanceId, ...filters }) =>
    Effect.gen(function* () {
      const scope = yield* callerScope;
      const listed = yield* (yield* ForkAgentSessionImport).list({
        ...filters,
        providerInstanceId: yield* forkSessionInstance(
          providerInstanceId,
          scope.thread.providerInstanceId,
        ),
      });
      return {
        ...listed,
        sessions: listed.sessions.map((session) => ({
          ...session,
          thread:
            session.thread === null
              ? null
              : {
                  ...session.thread,
                  link: McpInvocationContext.threadLinkFor(
                    scope,
                    session.thread.threadId,
                    session.thread.title ?? undefined,
                  ),
                },
        })),
      };
    }),
  ),
  t3_session_import: McpToolAccess.writesOwnerWork(
    "import agent sessions",
    ({ providerInstanceId, ...input }) =>
      Effect.gen(function* () {
        const scope = yield* callerScope;
        yield* forkAssertMayImportSessions({
          agents: yield* ForkDelegationAgents,
          callerThreadId: scope.thread.threadId,
        });
        const imported = yield* (yield* ForkAgentSessionImport).importSessions({
          ...input,
          providerInstanceId: yield* forkSessionInstance(
            providerInstanceId,
            scope.thread.providerInstanceId,
          ),
        });
        return {
          ...imported,
          results: imported.results.map((result) =>
            result.threadId === undefined
              ? result
              : {
                  ...result,
                  link: McpInvocationContext.threadLinkFor(
                    scope,
                    result.threadId,
                    result.title ?? undefined,
                  ),
                },
          ),
        };
      }),
  ),
});
