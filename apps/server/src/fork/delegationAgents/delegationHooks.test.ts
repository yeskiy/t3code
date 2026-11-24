import { describe, expect, it } from "@effect/vitest";
import {
  OrchestratorMcpFailure,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ForkTurnAgent,
  type OrchestratorMcpTarget,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ForkAgentError, type ForkAgentDefinition } from "./agentFile.ts";
import type { ForkDelegationAgents } from "./ForkDelegationAgents.ts";
import {
  applyAgentDefaults,
  forkAgentsCapability,
  forkAssertCanDelegate,
  forkClaudeAgentParts,
  forkCodexAgentContext,
  forkPrepareDelegation,
} from "./delegationHooks.ts";
import { advertisedJsonSchema } from "../../mcp/advertisedJsonSchema.ts";
import { OrchestratorToolkit } from "../../mcp/toolkits/orchestrator/tools.ts";

const failure = (code: OrchestratorMcpFailure["code"], message: string): OrchestratorMcpFailure =>
  new OrchestratorMcpFailure({ code, message });

const sampleAgent: ForkTurnAgent = {
  name: "researcher",
  limits: ["read-only", "no-delegation"],
  instructions: "x".repeat(9000),
};

const sampleDefinition: ForkAgentDefinition = {
  name: "researcher",
  description: "Read-only research.",
  roles: ["research", "review"],
  limits: ["read-only", "no-delegation"],
  skills: ["ste-base"],
  defaults: {
    claudeAgent: { model: "claude-opus-5-5", effort: "medium" },
    codex: { model: "gpt-5.4", effort: "low" },
  },
  body: "You are a read-only research agent.",
  path: "C:/agents/researcher.md",
};

const fakeAgents = (
  overrides: Partial<ForkDelegationAgents["Service"]> = {},
): ForkDelegationAgents["Service"] => ({
  list: Effect.succeed([]),
  resolveForTask: () => Effect.undefined,
  record: () => Effect.void,
  forThread: () => Effect.undefined,
  ...overrides,
});

const provider = (
  instanceId: string,
  driver: string,
  models: ServerProvider["models"] = [],
): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    models,
  }) as unknown as ServerProvider;

describe("forkClaudeAgentParts", () => {
  it("maps neutral limits to Claude tools", () => {
    expect(forkClaudeAgentParts(sampleAgent)).toEqual({
      appendText: sampleAgent.instructions,
      disallowedTools: ["Write", "Edit", "NotebookEdit", "Agent"],
    });
  });

  it("returns no disallowed tools when the agent has no limits", () => {
    expect(
      forkClaudeAgentParts({ name: "writer", limits: [], instructions: "Write prose." }),
    ).toEqual({
      appendText: "Write prose.",
      disallowedTools: [],
    });
  });
});

describe("forkCodexAgentContext", () => {
  it("splits the text into numbered entries of 4000 bytes or less", () => {
    const entries = forkCodexAgentContext(sampleAgent);
    expect(Object.keys(entries)).toEqual([
      "t3_code_agent_01",
      "t3_code_agent_02",
      "t3_code_agent_03",
    ]);
    expect(Object.values(entries).every((entry) => Buffer.byteLength(entry.value) <= 4000)).toBe(
      true,
    );
    expect(Object.values(entries).every((entry) => entry.kind === "application")).toBe(true);
    expect(
      Object.values(entries)
        .map((entry) => entry.value)
        .join(""),
    ).toBe(sampleAgent.instructions);
  });

  it("splits multi-byte UTF-8 text by bytes without breaking characters", () => {
    const accented = "é".repeat(5000);
    const entries = forkCodexAgentContext({ name: "writer", limits: [], instructions: accented });
    const values = Object.values(entries).map((entry) => entry.value);
    expect(values.every((value) => Buffer.byteLength(value) <= 4000)).toBe(true);
    expect(values.every((value) => !value.includes("\uFFFD"))).toBe(true);
    expect(values.join("")).toBe(accented);

    const emoji = "😀".repeat(1500);
    const emojiEntries = forkCodexAgentContext({ name: "writer", limits: [], instructions: emoji });
    const emojiValues = Object.values(emojiEntries).map((entry) => entry.value);
    expect(emojiValues.every((value) => Buffer.byteLength(value) <= 4000)).toBe(true);
    expect(emojiValues.every((value) => !value.includes("\uFFFD"))).toBe(true);
    expect(emojiValues.join("")).toBe(emoji);
  });

  it("returns no entries without an agent", () => {
    expect(forkCodexAgentContext(undefined)).toEqual({});
  });
});

describe("applyAgentDefaults", () => {
  const defaults = {
    claudeAgent: { model: "claude-opus-5-5", effort: "medium" },
    codex: { model: "gpt-5.4", effort: "low" },
  };

  it("fills the model and effort when the target has no model", () => {
    expect(
      applyAgentDefaults({
        target: undefined,
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        defaults,
      }),
    ).toEqual({
      providerInstanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: [{ id: "effort", value: "medium" }],
    });
  });

  it("uses reasoningEffort for codex defaults", () => {
    expect(
      applyAgentDefaults({
        target: undefined,
        instanceId: "codex",
        driver: "codex",
        defaults,
      }),
    ).toEqual({
      providerInstanceId: "codex",
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
  });

  it("keeps a target that names a model", () => {
    const target: OrchestratorMcpTarget = {
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-5",
    };
    expect(
      applyAgentDefaults({ target, instanceId: "claudeAgent", driver: "claudeAgent", defaults }),
    ).toBe(target);
  });

  it("keeps driverKind targets without forcing the parent instance id", () => {
    const target: OrchestratorMcpTarget = {
      driverKind: ProviderDriverKind.make("codex"),
    };
    expect(
      applyAgentDefaults({ target, instanceId: "claudeAgent", driver: "codex", defaults }),
    ).toEqual({
      driverKind: "codex",
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
  });
});

describe("forkAgentsCapability", () => {
  it("omits agents when none are defined", () => {
    expect(forkAgentsCapability([])).toEqual({});
  });

  it("projects summary fields for defined agents", () => {
    expect(forkAgentsCapability([sampleDefinition])).toEqual({
      agents: [
        {
          name: "researcher",
          description: "Read-only research.",
          roles: ["research", "review"],
          limits: ["read-only", "no-delegation"],
        },
      ],
    });
  });
});

describe("forkAssertCanDelegate", () => {
  it.effect("rejects callers whose agent has no-delegation", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        forkAssertCanDelegate({
          agents: fakeAgents({ forThread: () => Effect.succeed(sampleAgent) }),
          callerThreadId: ThreadId.make("thread:child"),
          failure,
        }),
      );
      expect(error.code).toBe("invalid_request");
      expect(error.message).toBe("This agent cannot delegate. Do the work yourself.");
    }),
  );

  it.effect("allows callers without no-delegation", () =>
    forkAssertCanDelegate({
      agents: fakeAgents({
        forThread: () =>
          Effect.succeed({ name: "planner", limits: ["read-only"], instructions: "Plan." }),
      }),
      callerThreadId: ThreadId.make("thread:child"),
      failure,
    }),
  );
});

describe("forkPrepareDelegation", () => {
  const providers = [
    provider("claudeAgent", "claudeAgent"),
    provider("claudeWork", "claudeAgent"),
    provider("codex", "codex"),
  ];

  it.effect("rejects delegation when the caller agent has no-delegation", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        forkPrepareDelegation({
          agents: fakeAgents({ forThread: () => Effect.succeed(sampleAgent) }),
          input: { role: "research" },
          callerThreadId: ThreadId.make("thread:child"),
          providers,
          instanceId: ProviderInstanceId.make("claudeAgent"),
          failure,
        }),
      );
      expect(error.code).toBe("invalid_request");
      expect(error.message).toBe("This agent cannot delegate. Do the work yourself.");
    }),
  );

  it.effect("maps ForkAgentError from resolveForTask to invalid_request", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        forkPrepareDelegation({
          agents: fakeAgents({
            resolveForTask: () =>
              Effect.fail(
                new ForkAgentError({ detail: "Unknown agent ghost. Agents: researcher." }),
              ),
          }),
          input: { agent: "ghost" },
          callerThreadId: ThreadId.make("thread:parent"),
          providers,
          instanceId: ProviderInstanceId.make("claudeAgent"),
          failure,
        }),
      );
      expect(error.code).toBe("invalid_request");
      expect(error.message).toBe("Unknown agent ghost. Agents: researcher.");
    }),
  );

  it.effect("resolves the agent and applies defaults for the target instance driver", () =>
    Effect.gen(function* () {
      const result = yield* forkPrepareDelegation({
        agents: fakeAgents({
          resolveForTask: ({ agent, role }) =>
            Effect.succeed(
              agent === undefined && role === "research" ? sampleDefinition : undefined,
            ),
        }),
        input: { role: "research" },
        callerThreadId: ThreadId.make("thread:parent"),
        providers,
        instanceId: ProviderInstanceId.make("claudeWork"),
        failure,
      });
      expect(result.definition).toEqual(sampleDefinition);
      expect(result.target).toEqual({
        providerInstanceId: "claudeWork",
        model: "claude-opus-5-5",
        options: [{ id: "effort", value: "medium" }],
      });
    }),
  );

  it.effect(
    "uses the driver of target.providerInstanceId when explicitly targeting another instance",
    () =>
      Effect.gen(function* () {
        const result = yield* forkPrepareDelegation({
          agents: fakeAgents({
            resolveForTask: () => Effect.succeed(sampleDefinition),
          }),
          input: {
            agent: "researcher",
            target: { providerInstanceId: ProviderInstanceId.make("codex") },
          },
          callerThreadId: ThreadId.make("thread:parent"),
          providers,
          instanceId: ProviderInstanceId.make("claudeAgent"),
          failure,
        });
        expect(result.target).toEqual({
          providerInstanceId: "codex",
          model: "gpt-5.4",
          options: [{ id: "reasoningEffort", value: "low" }],
        });
      }),
  );
});

describe("delegate_task input schema", () => {
  it("carries the agent field description into tools/list", () => {
    const schema = advertisedJsonSchema(OrchestratorToolkit.tools.delegate_task);
    const properties = schema.properties as Record<string, { readonly description?: string }>;
    expect(properties.agent?.description).toBe(
      "Name of a T3 agent from orchestrator_capabilities. Its instructions, limits, and model defaults apply to the child.",
    );
  });
});
