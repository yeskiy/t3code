import type { ForkTurnAgent, ThreadId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../config.ts";
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
  }
>()("t3/fork/delegationAgents/ForkDelegationAgents") {}

export const make = Effect.fn("fork.ForkDelegationAgents.make")(function* (input: {
  readonly agentsDir: string;
  readonly storePath: string;
  readonly skillRoots: ReadonlyArray<string>;
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

  const instructionsOf = (agent: ForkAgentDefinition) =>
    Effect.forEach(agent.skills, (name) =>
      readSkillText({ name, roots: input.skillRoots }).pipe(
        Effect.map((text) => `### Skill: ${name}\n\n${text}`),
      ),
    ).pipe(
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

  return ForkDelegationAgents.of({ list, resolveForTask, record, forThread });
});

export const layer = Layer.effect(
  ForkDelegationAgents,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* make({
      agentsDir: path.join(config.stateDir, "agents"),
      storePath: path.join(config.stateDir, "fork", "delegation-agents.json"),
      skillRoots: skillRoots(path, yield* HostProcess.HomeDirectory),
    });
  }),
);
