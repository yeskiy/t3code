import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { FORK_DELEGATION_AGENTS_WS_METHODS, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { forkDelegationAgentsRpcHandlers } from "./delegationAgentsRpc.ts";
import { make } from "./ForkDelegationAgents.ts";

const makeThreadId = Schema.decodeSync(ThreadId);
const child = makeThreadId("thread-rpc-child");

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  const agentsDir = path.join(dir, "agents");
  yield* fs.makeDirectory(agentsDir, { recursive: true });
  yield* fs.writeFileString(
    path.join(agentsDir, "worker.md"),
    `---
name: worker
description: Implementation worker.
limits: [no-delegation]
defaults:
  claudeAgent: { model: claude-opus-5-5, effort: high }
  codex: { model: gpt-5 }
---

Implement the brief.
`,
  );
  const agents = yield* make({
    agentsDir,
    storePath: path.join(dir, "fork", "delegation-agents.json"),
    skillRoots: [],
  });
  yield* agents.record(child, "worker");
  return forkDelegationAgentsRpcHandlers({
    agents,
    threadModel: (threadId) =>
      Effect.succeed(
        threadId === child ? { instanceId: "claudeAgent", model: "claude-sonnet-5-5" } : undefined,
      ),
    providers: Effect.succeed([{ instanceId: "claudeAgent", driver: "claudeAgent" }]),
  });
});

describe("forkDelegationAgentsRpcHandlers", () => {
  it.effect("returns the child agent with the defaults of its driver and its model", () =>
    Effect.gen(function* () {
      const handlers = yield* setup;
      const result = yield* handlers[FORK_DELEGATION_AGENTS_WS_METHODS.forThread]({
        threadId: child,
      });
      expect(result).toEqual({
        agent: {
          name: "worker",
          description: "Implementation worker.",
          roles: [],
          limits: ["no-delegation"],
          skills: [],
          defaults: [{ driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" }],
          instructionsBytes: Buffer.byteLength(
            "## T3 agent: worker\n\nImplement the brief.\n\nLimits: no-delegation: do not delegate, do the work yourself.",
          ),
        },
        driver: "claudeAgent",
        model: "claude-sonnet-5-5",
      });
      expect(result?.agent.instructions).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("adds the agent text when the caller asks for it", () =>
    Effect.gen(function* () {
      const handlers = yield* setup;
      const result = yield* handlers[FORK_DELEGATION_AGENTS_WS_METHODS.forThread]({
        threadId: child,
        includeInstructions: true,
      });
      expect(result?.agent.instructions).toContain("Implement the brief.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("returns null for a thread that ran without an agent", () =>
    Effect.gen(function* () {
      const handlers = yield* setup;
      expect(
        yield* handlers[FORK_DELEGATION_AGENTS_WS_METHODS.forThread]({
          threadId: makeThreadId("thread-rpc-plain"),
        }),
      ).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("lists all agents with every driver default and no text", () =>
    Effect.gen(function* () {
      const handlers = yield* setup;
      const agents = yield* handlers[FORK_DELEGATION_AGENTS_WS_METHODS.list]({});
      expect(agents.map((agent) => agent.defaults.map((preset) => preset.driver))).toEqual([
        ["claudeAgent", "codex"],
      ]);
      expect(agents[0]?.instructions).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
