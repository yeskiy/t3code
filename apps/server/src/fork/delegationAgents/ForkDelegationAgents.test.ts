import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../../config.ts";
import {
  FORK_AGENT_TEXT_MAX_BYTES,
  ForkDelegationAgents,
  layer,
  make,
} from "./ForkDelegationAgents.ts";

const makeThreadId = Schema.decodeSync(ThreadId);

const writeFixtures = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  const agentsDir = path.join(dir, "agents");
  const skillsDir = path.join(dir, "skills");
  const storePath = path.join(dir, "fork", "delegation-agents.json");

  yield* fs.makeDirectory(agentsDir, { recursive: true });
  yield* fs.makeDirectory(path.join(skillsDir, "ste-base"), { recursive: true });
  yield* fs.writeFileString(
    path.join(skillsDir, "ste-base", "SKILL.md"),
    "---\nname: ste-base\n---\n\nAlways verify before asserting.\n",
  );

  yield* fs.writeFileString(
    path.join(agentsDir, "writer.md"),
    `---
name: writer
description: Technical writer.
roles: [design]
---

Write crisp prose.
`,
  );
  yield* fs.writeFileString(
    path.join(agentsDir, "researcher.md"),
    `---
name: researcher
description: Read-only research.
roles: [research, review]
limits: [read-only, no-delegation]
skills: [ste-base]
defaults:
  claudeAgent: { model: claude-opus-5-5, effort: medium }
---

You are a read-only research agent.
`,
  );
  yield* fs.writeFileString(
    path.join(agentsDir, "planner.md"),
    `---
name: planner
description: Architecture planner.
limits: [read-only]
---

Plan carefully.
`,
  );
  yield* fs.writeFileString(
    path.join(agentsDir, "worker.md"),
    `---
name: worker
description: Implementation worker.
roles: [implementation]
---

Implement the plan.
`,
  );
  yield* fs.writeFileString(path.join(agentsDir, "README.txt"), "Not an agent.\n");

  return { dir, agentsDir, skillsDir, storePath };
});

describe("ForkDelegationAgents", () => {
  it.effect("lists agents sorted by name and skips non-markdown files", () =>
    Effect.gen(function* () {
      const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
      const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
      const agents = yield* service.list;
      expect(agents.map((agent) => agent.name)).toEqual([
        "planner",
        "researcher",
        "worker",
        "writer",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("returns an empty list when the agents directory does not exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const service = yield* make({
        agentsDir: path.join(dir, "missing-agents"),
        storePath: path.join(dir, "fork", "delegation-agents.json"),
        skillRoots: [],
      });
      expect(yield* service.list).toEqual([]);
      expect(yield* service.resolveForTask({ role: "research" })).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves by explicit agent name and fails on an unknown agent", () =>
    Effect.gen(function* () {
      const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
      const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });

      const found = yield* service.resolveForTask({ agent: "researcher" });
      expect(found?.name).toBe("researcher");

      const error = yield* Effect.flip(service.resolveForTask({ agent: "nope" }));
      expect(error.message).toBe(
        "Unknown agent nope. Agents: planner, researcher, worker, writer.",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "resolves by role, prefers explicit agent over role, and returns undefined for unmapped role",
    () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });

        const byRole = yield* service.resolveForTask({ role: "research" });
        expect(byRole?.name).toBe("researcher");

        const explicitWins = yield* service.resolveForTask({
          agent: "planner",
          role: "research",
        });
        expect(explicitWins?.name).toBe("planner");

        const unmapped = yield* service.resolveForTask({ role: "general" });
        expect(unmapped).toBeUndefined();
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails list when two agents claim the same role", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const agentsDir = path.join(dir, "agents");
      yield* fs.makeDirectory(agentsDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(agentsDir, "a.md"),
        "---\nname: a\ndescription: A\nroles: [research]\n---\n\nA\n",
      );
      yield* fs.writeFileString(
        path.join(agentsDir, "b.md"),
        "---\nname: b\ndescription: B\nroles: [research]\n---\n\nB\n",
      );
      const service = yield* make({
        agentsDir,
        storePath: path.join(dir, "fork", "delegation-agents.json"),
        skillRoots: [],
      });
      const error = yield* Effect.flip(service.list);
      expect(error.message).toBe("Role research is in more than one agent: a, b.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "records a child thread and returns formatted instructions with limits and skills",
    () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
        const threadId = makeThreadId("thread-child-1");

        yield* service.record(threadId, "researcher");
        const turnAgent = yield* service.forThread(threadId);
        expect(turnAgent).toBeDefined();
        expect(turnAgent?.name).toBe("researcher");
        expect(turnAgent?.limits).toEqual(["read-only", "no-delegation"]);
        expect(turnAgent?.instructions.startsWith("## T3 agent: researcher\n\n")).toBe(true);
        expect(turnAgent?.instructions).toContain("You are a read-only research agent.");
        expect(turnAgent?.instructions).toContain(
          "Limits: read-only: do not create, edit, or delete files. no-delegation: do not delegate, do the work yourself.",
        );
        expect(turnAgent?.instructions).toContain(
          "### Skill: ste-base\n\nAlways verify before asserting.",
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("persists recorded child thread mappings across service instances", () =>
    Effect.gen(function* () {
      const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
      const threadId = makeThreadId("thread-child-2");
      const first = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
      yield* first.record(threadId, "writer");

      const second = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
      const turnAgent = yield* second.forThread(threadId);
      expect(turnAgent).toEqual({
        name: "writer",
        limits: [],
        instructions: "## T3 agent: writer\n\nWrite crisp prose.",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails resolveForTask when rendered agent text exceeds the 32 KB cap", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
      const header = "## T3 agent: writer\n\n";
      const body = "x".repeat(40_000 - Buffer.byteLength(header));
      yield* fs.writeFileString(
        path.join(agentsDir, "writer.md"),
        `---\nname: writer\ndescription: Large writer.\n---\n\n${body}\n`,
      );

      const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
      const error = yield* Effect.flip(service.resolveForTask({ agent: "writer" }));
      expect(error.message).toBe(
        `Agent writer is 40000 bytes. The cap is ${FORK_AGENT_TEXT_MAX_BYTES} bytes.`,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("returns undefined from forThread for an unknown thread", () =>
    Effect.gen(function* () {
      const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
      const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
      expect(yield* service.forThread(makeThreadId("thread-unknown"))).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails forThread when a recorded agent definition was removed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
      const threadId = makeThreadId("thread-child-3");
      const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
      yield* service.record(threadId, "planner");
      yield* fs.remove(path.join(agentsDir, "planner.md"));

      const error = yield* Effect.flip(service.forThread(threadId));
      expect(error.message).toBe("Agent planner is no longer defined.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("wires stateDir agents, store, and home skill roots through layer", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-agent-home-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-agent-base-" });
      const stateDir = path.join(baseDir, "userdata");
      const agentsDir = path.join(stateDir, "agents");
      const skillDir = path.join(home, ".claude", "skills", "ste-base");
      yield* fs.makeDirectory(agentsDir, { recursive: true });
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), "Layered skill.\n");
      yield* fs.writeFileString(
        path.join(agentsDir, "researcher.md"),
        "---\nname: researcher\ndescription: Layered.\nskills: [ste-base]\n---\n\nLayered body.\n",
      );

      const testLayer = layer.pipe(
        Layer.provide(ServerConfig.layerTest(baseDir, baseDir)),
        Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
      );
      const threadId = makeThreadId("thread-layered-1");
      const result = yield* Effect.gen(function* () {
        const service = yield* ForkDelegationAgents;
        yield* service.record(threadId, "researcher");
        return yield* service.forThread(threadId);
      }).pipe(Effect.provide(testLayer));

      expect(result).toEqual({
        name: "researcher",
        limits: [],
        instructions:
          "## T3 agent: researcher\n\nLayered body.\n\n### Skill: ste-base\n\nLayered skill.",
      });
      expect(yield* fs.exists(path.join(stateDir, "fork", "delegation-agents.json"))).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "finds claude.ai synced skills after home roots and respects syncClaudeAiSkills: false",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-agent-synced-home-" });
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-agent-synced-base-" });
        const stateDir = path.join(baseDir, "userdata");
        const agentsDir = path.join(stateDir, "agents");
        const orgId = "11111111-2222-4333-8444-555555555555";
        const accountId = "66666666-7777-4888-9999-aaaaaaaaaaaa";
        const bucket = `${orgId}_${accountId}`;
        const syncedDir = path.join(home, ".claude", "skills", "synced");
        const syncedDocxDir = path.join(syncedDir, bucket, "docx");
        const syncedPdfDir = path.join(syncedDir, bucket, "pdf");
        const localPdfDir = path.join(home, ".claude", "skills", "pdf");

        yield* fs.makeDirectory(agentsDir, { recursive: true });
        yield* fs.makeDirectory(syncedDocxDir, { recursive: true });
        yield* fs.makeDirectory(syncedPdfDir, { recursive: true });
        yield* fs.makeDirectory(localPdfDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(home, ".claude.json"),
          JSON.stringify({
            oauthAccount: { organizationUuid: orgId, accountUuid: accountId },
          }),
        );
        yield* fs.writeFileString(path.join(syncedDir, `.bucket-${bucket}`), "");
        yield* fs.writeFileString(
          path.join(syncedDocxDir, "SKILL.md"),
          "---\nname: docx\ndescription: Word documents.\n---\n\nSynced docx body.\n",
        );
        yield* fs.writeFileString(
          path.join(syncedPdfDir, "SKILL.md"),
          "---\nname: pdf\n---\n\nSynced pdf body.\n",
        );
        yield* fs.writeFileString(
          path.join(localPdfDir, "SKILL.md"),
          "---\nname: pdf\n---\n\nLocal pdf body.\n",
        );
        yield* fs.writeFileString(
          path.join(agentsDir, "docs.md"),
          "---\nname: docs\ndescription: Document helper.\nskills: [docx, pdf]\n---\n\nHandle documents.\n",
        );

        const testLayer = layer.pipe(
          Layer.provide(ServerConfig.layerTest(baseDir, baseDir)),
          Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
          Layer.provide(Layer.succeed(HostProcess.Environment, {})),
          Layer.provide(Layer.succeed(HostProcess.Platform, "win32")),
        );
        const threadId = makeThreadId("thread-synced-1");
        const resolved = yield* Effect.gen(function* () {
          const service = yield* ForkDelegationAgents;
          yield* service.resolveForTask({ agent: "docs" });
          yield* service.record(threadId, "docs");
          return yield* service.forThread(threadId);
        }).pipe(Effect.provide(testLayer));

        expect(resolved).toEqual({
          name: "docs",
          limits: [],
          instructions:
            "## T3 agent: docs\n\nHandle documents.\n\n### Skill: docx\n\nSynced docx body.\n\n### Skill: pdf\n\nLocal pdf body.",
        });

        yield* fs.writeFileString(
          path.join(home, ".claude", "settings.json"),
          JSON.stringify({ syncClaudeAiSkills: false }),
        );
        const hiddenError = yield* Effect.gen(function* () {
          const service = yield* ForkDelegationAgents;
          return yield* Effect.flip(service.resolveForTask({ agent: "docs" }));
        }).pipe(Effect.provide(testLayer));

        expect(hiddenError.message).toContain("Skill docx is not in ");
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  describe("describe", () => {
    it.effect("summarizes every agent with skills, defaults, and the agent text size", () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
        const threadId = makeThreadId("thread-describe-1");
        yield* service.record(threadId, "researcher");
        const text = (yield* service.forThread(threadId))?.instructions ?? "";

        const all = yield* service.describe({ includeInstructions: false });
        expect(all.map((agent) => agent.name)).toEqual([
          "planner",
          "researcher",
          "worker",
          "writer",
        ]);
        expect(all.find((agent) => agent.name === "researcher")).toEqual({
          name: "researcher",
          description: "Read-only research.",
          roles: ["research", "review"],
          limits: ["read-only", "no-delegation"],
          skills: ["ste-base"],
          defaults: [{ driver: "claudeAgent", model: "claude-opus-5-5", effort: "medium" }],
          instructionsBytes: Buffer.byteLength(text),
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("adds the agent text only on request", () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
        const [writer] = yield* service.describe({ includeInstructions: true, name: "writer" });
        expect(writer?.instructions).toBe("## T3 agent: writer\n\nWrite crisp prose.");
        expect(writer?.instructionsBytes).toBe(Buffer.byteLength(writer?.instructions ?? ""));
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("returns the agent recorded for a thread and nothing for other threads", () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
        const child = makeThreadId("thread-describe-child");
        yield* service.record(child, "planner");

        const recorded = yield* service.describe({ includeInstructions: false, threadId: child });
        expect(recorded.map((agent) => agent.name)).toEqual(["planner"]);
        const other = yield* service.describe({
          includeInstructions: false,
          threadId: makeThreadId("thread-describe-other"),
        });
        expect(other).toEqual([]);
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("keeps a broken agent in the list with its problem and no size", () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(agentsDir, "broken.md"),
          "---\nname: broken\ndescription: Broken.\nskills: [missing-skill]\n---\n\nBody\n",
        );
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
        const broken = (yield* service.describe({ includeInstructions: true })).find(
          (agent) => agent.name === "broken",
        );
        expect(broken?.skills).toEqual(["missing-skill"]);
        expect(broken?.instructionsBytes).toBeUndefined();
        expect(broken?.instructions).toBeUndefined();
        expect(broken?.problem).toContain("Skill missing-skill is not in ");
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("names a recorded agent whose file is gone", () =>
      Effect.gen(function* () {
        const { agentsDir, skillsDir, storePath } = yield* writeFixtures;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const service = yield* make({ agentsDir, storePath, skillRoots: [skillsDir] });
        const child = makeThreadId("thread-describe-gone");
        yield* service.record(child, "worker");
        yield* fs.remove(path.join(agentsDir, "worker.md"));

        expect(yield* service.describe({ includeInstructions: false, threadId: child })).toEqual([
          {
            name: "worker",
            description: "",
            roles: [],
            limits: [],
            skills: [],
            defaults: [],
            problem: "Agent worker is no longer defined.",
          },
        ]);
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  });
});
