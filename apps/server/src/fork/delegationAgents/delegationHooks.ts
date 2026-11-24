import type {
  ForkAgentSummary,
  ForkTurnAgent,
  OrchestratorMcpFailure,
  OrchestratorMcpTarget,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ForkClaudeAgentParts } from "../instanceLaunch/ForkClaudeLaunch.ts";
import type { ForkAgentDefinition } from "./agentFile.ts";
import { ForkDelegationAgents } from "./ForkDelegationAgents.ts";

const CODEX_ENTRY_MAX_BYTES = 4000;
const CLAUDE_LIMIT_TOOLS = {
  "read-only": ["Write", "Edit", "NotebookEdit"],
  "no-delegation": ["Agent"],
} as const;
const NO_DELEGATION_MESSAGE = "This agent cannot delegate. Do the work yourself.";

type FailureFn = (code: OrchestratorMcpFailure["code"], message: string) => OrchestratorMcpFailure;

export const forkDelegationAgentsLayerEmpty = Layer.succeed(
  ForkDelegationAgents,
  ForkDelegationAgents.of({
    list: Effect.succeed([]),
    resolveForTask: Effect.fn("ForkDelegationAgents.resolveForTask")(function () {
      return Effect.undefined;
    }),
    record: Effect.fn("ForkDelegationAgents.record")(function () {
      return Effect.void;
    }),
    forThread: Effect.fn("ForkDelegationAgents.forThread")(function () {
      return Effect.undefined;
    }),
  }),
);

export const forkClaudeAgentParts = (agent: ForkTurnAgent): ForkClaudeAgentParts => ({
  appendText: agent.instructions,
  disallowedTools: agent.limits.flatMap((limit) => CLAUDE_LIMIT_TOOLS[limit]),
});

const chunks = (text: string): ReadonlyArray<string> =>
  Buffer.byteLength(text) <= CODEX_ENTRY_MAX_BYTES
    ? [text]
    : (() => {
        const head = Buffer.from(text)
          .subarray(0, CODEX_ENTRY_MAX_BYTES)
          .toString("utf8")
          .replace(/\uFFFD$/, "");
        return [head, ...chunks(text.slice(head.length))];
      })();

export const forkCodexAgentContext = (
  agent: ForkTurnAgent | undefined,
): Record<string, { readonly kind: "application"; readonly value: string }> =>
  agent === undefined
    ? {}
    : Object.fromEntries(
        chunks(agent.instructions).map((value, index) => [
          `t3_code_agent_${String(index + 1).padStart(2, "0")}`,
          { kind: "application" as const, value },
        ]),
      );

const defaultEffortOptionId = (driver: string): string =>
  driver === "codex" ? "reasoningEffort" : "effort";

export const applyAgentDefaults = (input: {
  readonly target: OrchestratorMcpTarget | undefined;
  readonly instanceId: string;
  readonly driver: string;
  readonly defaults: ForkAgentDefinition["defaults"];
  readonly effortOptionId?: string | undefined;
}): OrchestratorMcpTarget | undefined => {
  const preset = input.defaults[input.driver];
  if (input.target?.model !== undefined || preset?.model === undefined) return input.target;
  const keepDriverOnly =
    input.target?.providerInstanceId === undefined && input.target?.driverKind !== undefined;
  const optionId = input.effortOptionId ?? defaultEffortOptionId(input.driver);
  return {
    ...input.target,
    ...(keepDriverOnly
      ? {}
      : { providerInstanceId: (input.target?.providerInstanceId ?? input.instanceId) as never }),
    model: preset.model,
    ...(preset.effort === undefined || input.target?.options !== undefined
      ? {}
      : { options: [{ id: optionId, value: preset.effort }] }),
  } as OrchestratorMcpTarget;
};

export const forkAgentsCapability = (
  agents: ReadonlyArray<ForkAgentDefinition>,
): { readonly agents?: ReadonlyArray<ForkAgentSummary> } =>
  agents.length === 0
    ? {}
    : {
        agents: agents.map(({ name, description, provider, roles, limits }) => ({
          name,
          description,
          ...(provider === undefined ? {} : { provider }),
          roles: [...roles],
          limits: [...limits],
        })),
      };

export const forkAssertCanDelegate = Effect.fn("fork.assertCanDelegate")(function* (input: {
  readonly agents: ForkDelegationAgents["Service"];
  readonly callerThreadId: ThreadId;
  readonly failure: FailureFn;
}) {
  const callerAgent = yield* input.agents
    .forThread(input.callerThreadId)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (callerAgent?.limits.includes("no-delegation") === true) {
    return yield* input.failure("invalid_request", NO_DELEGATION_MESSAGE);
  }
});

const reasoningOptionIdFor = (
  provider: ServerProvider | undefined,
  model: string | undefined,
): string | undefined => {
  if (provider === undefined || model === undefined) return undefined;
  return provider.models
    .find((candidate) => candidate.slug === model)
    ?.capabilities?.optionDescriptors?.find(
      (descriptor) => descriptor.type === "select" && descriptor.role === "reasoning",
    )?.id;
};

export const forkPrepareDelegation = Effect.fn("fork.prepareDelegation")(function* (input: {
  readonly agents: ForkDelegationAgents["Service"];
  readonly input: {
    readonly agent?: string | undefined;
    readonly role?: string | undefined;
    readonly target?: OrchestratorMcpTarget | undefined;
  };
  readonly callerThreadId: ThreadId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly instanceId: ProviderInstanceId;
  readonly failure: FailureFn;
}) {
  yield* forkAssertCanDelegate({
    agents: input.agents,
    callerThreadId: input.callerThreadId,
    failure: input.failure,
  });
  const definition = yield* input.agents
    .resolveForTask({ agent: input.input.agent, role: input.input.role })
    .pipe(Effect.mapError((error) => input.failure("invalid_request", error.message)));
  if (definition === undefined) {
    return { definition: undefined, target: input.input.target };
  }
  const targetInstanceId = input.input.target?.providerInstanceId;
  const targetDriverKind = input.input.target?.driverKind;
  const wantsAgentProvider =
    targetInstanceId === undefined &&
    targetDriverKind === undefined &&
    definition.provider !== undefined;
  const agentProvider = wantsAgentProvider
    ? input.providers.find((candidate) => candidate.instanceId === definition.provider)
    : undefined;
  if (
    wantsAgentProvider &&
    (agentProvider === undefined ||
      agentProvider.enabled === false ||
      agentProvider.status === "disabled")
  ) {
    return yield* input.failure(
      "invalid_request",
      `Agent ${definition.name} names provider ${definition.provider}, which is not available.`,
    );
  }
  const baseTarget: OrchestratorMcpTarget | undefined =
    agentProvider === undefined
      ? input.input.target
      : {
          ...input.input.target,
          providerInstanceId: agentProvider.instanceId,
        };
  const matchedProvider =
    agentProvider ??
    (targetInstanceId !== undefined
      ? input.providers.find((candidate) => candidate.instanceId === targetInstanceId)
      : targetDriverKind !== undefined
        ? input.providers.find((candidate) => candidate.driver === targetDriverKind)
        : input.providers.find((candidate) => candidate.instanceId === input.instanceId));
  const driver =
    agentProvider !== undefined || targetInstanceId !== undefined
      ? matchedProvider?.driver
      : (targetDriverKind ?? matchedProvider?.driver);
  const target =
    driver === undefined
      ? baseTarget
      : applyAgentDefaults({
          target: baseTarget,
          instanceId: agentProvider?.instanceId ?? input.instanceId,
          driver,
          defaults: definition.defaults,
          effortOptionId: reasoningOptionIdFor(matchedProvider, definition.defaults[driver]?.model),
        });
  return { definition, target };
});
