import type { ForkAgentDetail, ForkTurnAgent, ServerSettings, ThreadId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  DEFAULT_CLAUDE_SYNCED_SKILLS_INSTANCE,
  resolveSyncedSkillsForClaudeInstance,
} from "../syncedSkills/ClaudeSyncedSkills.ts";
import { ForkAgentError, parseAgentFile, type ForkAgentDefinition } from "./agentFile.ts";
import { readSkillText, skillRoots } from "./skillText.ts";

export const FORK_AGENT_TEXT_MAX_BYTES = 32 * 1024;
const STORE_MAX_ENTRIES = 5000;
const LIMIT_TEXT = {
  "read-only": "read-only: do not create, edit, or delete files.",
  "no-delegation": "no-delegation: do not delegate, do the work yourself.",
} as const;

const StoreEntry = Schema.Struct({
  agent: Schema.String,
  at: Schema.String,
});
type StoreEntry = typeof StoreEntry.Type;

const StoreFile = Schema.Struct({
  version: Schema.optional(Schema.Number),
  threads: Schema.optional(Schema.Record(Schema.String, StoreEntry)),
});

const decodeStoreFile = Schema.decodeUnknownEffect(Schema.fromJsonString(StoreFile));
const encodeStoreFile = Schema.encodeEffect(Schema.fromJsonString(StoreFile));

export class ForkDelegationAgents extends Context.Service<
  ForkDelegationAgents,
  {
    readonly list: Effect.Effect<ReadonlyArray<ForkAgentDefinition>, ForkAgentError>;
    readonly resolveForTask: (input: {
      readonly agent?: string | undefined;
      readonly role?: string | undefined;
    }) => Effect.Effect<ForkAgentDefinition | undefined, ForkAgentError>;
    readonly record: (childThreadId: ThreadId, agentName: string) => Effect.Effect<void>;
    readonly forThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ForkTurnAgent | undefined, ForkAgentError>;
    readonly describe: (input: {
      readonly includeInstructions: boolean;
      readonly name?: string | undefined;
      readonly threadId?: ThreadId | undefined;
    }) => Effect.Effect<ReadonlyArray<ForkAgentDetail>, ForkAgentError>;
  }
>()("t3/fork/delegationAgents/ForkDelegationAgents") {}

export const make = Effect.fn("fork.ForkDelegationAgents.make")(function* (input: {
  readonly agentsDir: string;
  readonly storePath: string;
  readonly skillRoots: ReadonlyArray<string>;
  readonly extraSkillRoots?: Effect.Effect<ReadonlyArray<string>>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const writeLock = yield* Semaphore.make(1);
  const stored = yield* fs.readFileString(input.storePath).pipe(
    Effect.flatMap(decodeStoreFile),
    Effect.map((parsed): Record<string, StoreEntry> => ({ ...parsed.threads })),
    Effect.orElseSucceed((): Record<string, StoreEntry> => ({})),
  );
  const store = yield* Ref.make(stored);

  const list = Effect.gen(function* () {
    const names = yield* fs
      .readDirectory(input.agentsDir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const agents = yield* Effect.forEach(
      names.filter((name) => name.endsWith(".md")).toSorted(),
      (name) => {
        const file = path.join(input.agentsDir, name);
        return fs.readFileString(file).pipe(
          Effect.mapError(
            () => new ForkAgentError({ detail: `Agent file ${file} cannot be read.` }),
          ),
          Effect.flatMap((text) => parseAgentFile({ path: file, text })),
        );
      },
    );
    const owners = agents.flatMap((agent) =>
      agent.roles.map((role) => [role, agent.name] as const),
    );
    const duplicate = owners.find(
      ([role], index) => owners.findIndex(([other]) => other === role) !== index,
    );
    if (duplicate !== undefined) {
      const holders = owners.filter(([role]) => role === duplicate[0]).map(([, name]) => name);
      return yield* new ForkAgentError({
        detail: `Role ${duplicate[0]} is in more than one agent: ${holders.join(", ")}.`,
      });
    }
    return agents;
  }).pipe(Effect.provide(services));

  const resolveRoots = input.extraSkillRoots
    ? input.extraSkillRoots.pipe(
        Effect.map((extra) => [...input.skillRoots, ...extra]),
        Effect.orElseSucceed(() => input.skillRoots),
      )
    : Effect.succeed(input.skillRoots);

  const instructionsOf = (agent: ForkAgentDefinition) =>
    (agent.skills.length === 0 ? Effect.succeed(input.skillRoots) : resolveRoots).pipe(
      Effect.flatMap((roots) =>
        Effect.forEach(agent.skills, (name) =>
          readSkillText({ name, roots }).pipe(
            Effect.map((text) => `### Skill: ${name}\n\n${text}`),
          ),
        ),
      ),
      Effect.map((skills) =>
        [
          `## T3 agent: ${agent.name}`,
          ...(agent.body === "" ? [] : [agent.body]),
          ...(agent.limits.length === 0
            ? []
            : [`Limits: ${agent.limits.map((limit) => LIMIT_TEXT[limit]).join(" ")}`]),
          ...skills,
        ].join("\n\n"),
      ),
      Effect.filterOrFail(
        (text) => Buffer.byteLength(text) <= FORK_AGENT_TEXT_MAX_BYTES,
        (text) =>
          new ForkAgentError({
            detail: `Agent ${agent.name} is ${Buffer.byteLength(text)} bytes. The cap is ${FORK_AGENT_TEXT_MAX_BYTES} bytes.`,
          }),
      ),
      Effect.provide(services),
    );

  const resolveForTask = Effect.fn("ForkDelegationAgents.resolveForTask")(function* (request: {
    readonly agent?: string | undefined;
    readonly role?: string | undefined;
  }) {
    const agents = yield* list;
    const agent =
      request.agent !== undefined
        ? agents.find((candidate) => candidate.name === request.agent)
        : agents.find(
            (candidate) => request.role !== undefined && candidate.roles.includes(request.role),
          );
    if (request.agent !== undefined && agent === undefined) {
      return yield* new ForkAgentError({
        detail: `Unknown agent ${request.agent}. Agents: ${agents.map((a) => a.name).join(", ")}.`,
      });
    }
    if (agent !== undefined) yield* instructionsOf(agent);
    return agent;
  });

  const record = Effect.fn("ForkDelegationAgents.record")(
    function* (childThreadId: ThreadId, agentName: string) {
      const now = DateTime.formatIso(yield* DateTime.now);
      const next = Object.fromEntries(
        Object.entries({
          ...(yield* Ref.get(store)),
          [childThreadId]: { agent: agentName, at: now },
        })
          .toSorted(([, a], [, b]) => b.at.localeCompare(a.at))
          .slice(0, STORE_MAX_ENTRIES),
      );
      yield* Ref.set(store, next);
      yield* fs.makeDirectory(path.dirname(input.storePath), { recursive: true });
      const contents = yield* encodeStoreFile({ version: 1, threads: next });
      yield* writeFileStringAtomically({ filePath: input.storePath, contents });
    },
    (effect) =>
      writeLock
        .withPermits(1)(effect)
        .pipe(
          Effect.provide(services),
          Effect.catch((cause) => Effect.logWarning("fork agent store write failed", { cause })),
        ),
  );

  const forThread = Effect.fn("ForkDelegationAgents.forThread")(function* (threadId: ThreadId) {
    const entry = (yield* Ref.get(store))[threadId];
    if (entry === undefined) return undefined;
    const agent = (yield* list).find((candidate) => candidate.name === entry.agent);
    if (agent === undefined) {
      return yield* new ForkAgentError({ detail: `Agent ${entry.agent} is no longer defined.` });
    }
    return {
      name: agent.name,
      limits: agent.limits,
      instructions: yield* instructionsOf(agent),
    } satisfies ForkTurnAgent;
  });

  const detailOf = (agent: ForkAgentDefinition, includeInstructions: boolean) =>
    instructionsOf(agent).pipe(
      Effect.map((text) => ({
        instructionsBytes: Buffer.byteLength(text),
        ...(includeInstructions ? { instructions: text } : {}),
      })),
      Effect.catch((error) => Effect.succeed({ problem: error.message })),
      Effect.map((rendered): ForkAgentDetail => ({
        name: agent.name,
        description: agent.description,
        ...(agent.provider === undefined ? {} : { provider: agent.provider }),
        roles: [...agent.roles],
        limits: [...agent.limits],
        skills: [...agent.skills],
        defaults: Object.entries(agent.defaults).map(([driver, preset]) => ({
          driver,
          ...(preset.model === undefined ? {} : { model: preset.model }),
          ...(preset.effort === undefined ? {} : { effort: preset.effort }),
        })),
        ...rendered,
      })),
    );

  const describe = Effect.fn("ForkDelegationAgents.describe")(function* (request: {
    readonly includeInstructions: boolean;
    readonly name?: string | undefined;
    readonly threadId?: ThreadId | undefined;
  }) {
    const wanted =
      request.threadId === undefined
        ? request.name
        : (yield* Ref.get(store))[request.threadId]?.agent;
    if (request.threadId !== undefined && wanted === undefined) return [];
    const agents = (yield* list).filter((agent) => wanted === undefined || agent.name === wanted);
    if (wanted !== undefined && agents.length === 0) {
      return [
        {
          name: wanted,
          description: "",
          roles: [],
          limits: [],
          skills: [],
          defaults: [],
          problem: `Agent ${wanted} is no longer defined.`,
        },
      ] satisfies ReadonlyArray<ForkAgentDetail>;
    }
    return yield* Effect.forEach(agents, (agent) => detailOf(agent, request.includeInstructions));
  });

  return ForkDelegationAgents.of({ list, resolveForTask, record, forThread, describe });
});

export const layer = Layer.effect(
  ForkDelegationAgents,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* HostProcess.HomeDirectory;
    const platform = yield* HostProcess.Platform;
    const hostEnvironment = yield* HostProcess.Environment;
    const serverSettings = yield* Effect.serviceOption(ServerSettingsService);
    const emptySettings: Pick<ServerSettings, "providerInstances"> = { providerInstances: {} };
    const extraSkillRoots = (
      Option.isSome(serverSettings)
        ? serverSettings.value.getSettings.pipe(Effect.orElseSucceed(() => emptySettings))
        : Effect.succeed(emptySettings)
    ).pipe(
      Effect.flatMap((settings) =>
        resolveSyncedSkillsForClaudeInstance({
          claudeInstanceId: DEFAULT_CLAUDE_SYNCED_SKILLS_INSTANCE,
          settings,
          hostEnvironment,
        }),
      ),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Platform, platform),
    );
    return yield* make({
      agentsDir: path.join(config.stateDir, "agents"),
      storePath: path.join(config.stateDir, "fork", "delegation-agents.json"),
      skillRoots: skillRoots(path, home),
      extraSkillRoots,
    });
  }),
);
