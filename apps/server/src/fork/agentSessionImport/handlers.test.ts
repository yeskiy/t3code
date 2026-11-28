import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type ForkAgentLimit,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkDelegationAgents } from "../delegationAgents/ForkDelegationAgents.ts";
import { ForkAgentSessionImport, type ImportInput } from "./ForkAgentSessionImport.ts";
import * as Handlers from "./handlers.ts";
import { ForkAgentSessionImportToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:session-import");
const callerThreadId = ThreadId.make("thread:caller");
const WORK = ProviderInstanceId.make("claudeWork");
const importedThreadId = ThreadId.make(`import:${WORK}:702769fb-1111-4222-8333-444455556666`);

const harness = (options: {
  readonly limits?: ReadonlyArray<ForkAgentLimit>;
  readonly runtimeMode?: RuntimeMode;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<ImportInput>>([]);
    const layer = McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(McpInvocationContext.McpInvocationContext, {
            environmentId,
            requestNamespace: "provider:session-import",
            thread: {
              threadId: callerThreadId,
              providerSessionId: "provider:session-import",
              providerInstanceId: WORK,
            },
            client: undefined,
            capabilities: new Set(["orchestration" as const]),
            issuedAt: 0,
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (threadId) =>
              Effect.succeed({
                ...liveThreadShell(
                  threadId,
                  options.runtimeMode === undefined ? {} : { runtimeMode: options.runtimeMode },
                ),
                providerInstanceId: WORK,
              }),
          }),
          Layer.succeed(
            ForkDelegationAgents,
            ForkDelegationAgents.of({
              list: Effect.succeed([]),
              resolveForTask: () => Effect.undefined,
              record: () => Effect.void,
              forThread: () =>
                Effect.succeed(
                  options.limits === undefined
                    ? undefined
                    : { name: "researcher", limits: options.limits, instructions: "" },
                ),
              describe: () => Effect.succeed([]),
            }),
          ),
          Layer.succeed(
            ForkAgentSessionImport,
            ForkAgentSessionImport.of({
              list: (input) =>
                Effect.succeed({
                  providerInstanceId: input.providerInstanceId,
                  sessions: [
                    {
                      sessionId: "702769fb-1111-4222-8333-444455556666",
                      projectFolder: "-repo",
                      cwd: "/repo",
                      title: "serein",
                      firstMessage: "Fix it",
                      messageCount: 2,
                      sizeBytes: 100,
                      lastChangedAt: "2026-11-01T00:00:00.000Z",
                      thread: {
                        threadId: importedThreadId,
                        title: "serein",
                        projectId: ProjectId.make("repo"),
                        imported: true,
                        hasRuns: false,
                        deleted: false,
                      },
                    },
                  ],
                  truncated: false,
                }),
              importSessions: (input) =>
                Ref.update(calls, (current) => [...current, input]).pipe(
                  Effect.as({
                    providerInstanceId: input.providerInstanceId,
                    results: [
                      {
                        sessionId: "702769fb-1111-4222-8333-444455556666",
                        status: "imported" as const,
                        threadId: importedThreadId,
                        title: "serein",
                        projectId: ProjectId.make("repo"),
                      },
                    ],
                  }),
                ),
            }),
          ),
        ),
      ),
    );
    return { calls, layer };
  });

const call = (
  name: "t3_session_import_list" | "t3_session_import",
  params: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* ForkAgentSessionImportToolkit;
    const results = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect);
    return results.at(-1)?.result;
  });

describe("agent session import tools", () => {
  it.effect("lists the caller's instance by default and links the thread", () =>
    Effect.gen(function* () {
      const { layer } = yield* harness({ limits: ["read-only"] });
      const result = yield* call("t3_session_import_list", {}).pipe(Effect.provide(layer));
      expect(result).toMatchObject({
        providerInstanceId: WORK,
        sessions: [
          { thread: { threadId: importedThreadId, link: expect.stringContaining("serein") } },
        ],
      });
    }),
  );

  it.effect("imports on the caller's instance and returns a thread link", () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* harness({});
      const result = yield* call("t3_session_import", {
        sessionIds: ["702769fb-1111-4222-8333-444455556666"],
      }).pipe(Effect.provide(layer));
      expect(result).toMatchObject({
        results: [{ status: "imported", threadId: importedThreadId, link: expect.any(String) }],
      });
      expect((yield* Ref.get(calls)).map((input) => input.providerInstanceId)).toEqual([WORK]);
    }),
  );

  it.effect("refuses an import from a read-only agent and never calls the importer", () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* harness({ limits: ["read-only"] });
      const result = yield* call("t3_session_import", {
        sessionIds: ["702769fb-1111-4222-8333-444455556666"],
      }).pipe(Effect.provide(layer));
      expect(result).toMatchObject({ code: "capability_denied" });
      expect(yield* Ref.get(calls)).toEqual([]);
    }),
  );

  it.effect("refuses an import from a caller below full access", () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* harness({ runtimeMode: "approval-required" });
      const result = yield* call("t3_session_import", {
        sessionIds: ["702769fb-1111-4222-8333-444455556666"],
      }).pipe(Effect.provide(layer));
      expect(result).toMatchObject({ code: "capability_denied" });
      expect(yield* Ref.get(calls)).toEqual([]);
    }),
  );
});
