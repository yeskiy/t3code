import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as AgentSessionImporter from "../../project/AgentSessionImporter.ts";
import * as AgentSessionScanner from "../../project/AgentSessionScanner.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as ForkAgentSessionImport from "./ForkAgentSessionImport.ts";

const PERSONAL = ProviderInstanceId.make("claudeAgent");
const WORK = ProviderInstanceId.make("claudeWork");
const REPO_PROJECT = ProjectId.make("fork-import-repo");
const OTHER_PROJECT = ProjectId.make("fork-import-other");
const OLD_ID = "702769fb-1111-4222-8333-444455556666";
const OTHER_ID = "22222222-3333-4444-8555-666666666666";
const WORK_ID = "33333333-4444-4555-8666-777777777777";
const DAY_SECONDS = 24 * 60 * 60;
// 2026-11-01T00:00:00Z. The test clock starts at 0, so file times use a fixed base.
const BASE_SECONDS = 1_793_491_200;
const timestamp = "2026-09-01T10:00:00.000Z";

const stores = Layer.mergeAll(
  EventStore.layer,
  ProjectionStore.layer.pipe(Layer.provide(NodeCrypto.layerDigest)),
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const persistence = Layer.mergeAll(
  stores,
  EventSink.layer.pipe(Layer.provide(stores)),
  ProviderSessionRuntime.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
  IdAllocator.layer,
);

const sessionText = (id: string, cwd: string, text: string) =>
  `${[
    { type: "user", cwd, sessionId: id, timestamp, message: { role: "user", content: text } },
    {
      type: "assistant",
      sessionId: id,
      timestamp,
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;

const writeSession = Effect.fn(function* (input: {
  readonly home: string;
  readonly id: string;
  readonly cwd: string;
  readonly text: string;
  readonly ageDays: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(input.home, "projects", "-slug");
  yield* fs.makeDirectory(folder, { recursive: true });
  const filePath = path.join(folder, `${input.id}.jsonl`);
  yield* fs.writeFileString(filePath, sessionText(input.id, input.cwd, input.text));
  const seconds = BASE_SECONDS - input.ageDays * DAY_SECONDS;
  yield* fs.utimes(filePath, seconds, seconds);
  return filePath;
});

const project = (id: ProjectId, workspaceRoot: string) => ({
  id,
  title: id,
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
});

const seedNativeOwner = Effect.fn(function* (sessionId: string) {
  const sink = yield* EventSink.EventSinkV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const now = DateTime.makeUnsafe(timestamp);
  const threadId = ThreadId.make("native-serein");
  const driver = ProviderDriverKind.make("claudeAgent");
  const providerThread: OrchestrationV2ProviderThread = {
    id: ids.derive.providerThread({ driver, nativeThreadId: sessionId }),
    driver,
    providerInstanceId: PERSONAL,
    providerSessionId: null,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: { driver, nativeId: sessionId, strength: "strong" },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
  };
  const thread: OrchestrationV2AppThread = {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: REPO_PROJECT,
    title: "serein",
    providerInstanceId: PERSONAL,
    modelSelection: { instanceId: PERSONAL, model: "claude-opus-4-1" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: providerThread.id,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
  };
  yield* sink.write({
    events: [
      {
        id: EventId.make(`${threadId}:created`),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: thread,
      },
      {
        id: EventId.make(`${threadId}:provider`),
        type: "provider-thread.updated",
        threadId,
        occurredAt: now,
        payload: providerThread,
      },
    ],
  });
  return threadId;
});

const makeHarness = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const personalHome = yield* fs.makeTempDirectoryScoped({ prefix: "fork-import-personal-" });
  const workHome = yield* fs.makeTempDirectoryScoped({ prefix: "fork-import-work-" });
  const repo = yield* fs.makeTempDirectoryScoped({ prefix: "fork-import-repo-" });
  const otherRoot = yield* fs.makeTempDirectoryScoped({ prefix: "fork-import-other-" });
  const projects = [project(REPO_PROJECT, repo), project(OTHER_PROJECT, otherRoot)];
  const settings = ServerSettings.layerTest({
    providerInstances: {
      [PERSONAL]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        config: { homePath: personalHome },
      },
      [WORK]: { driver: ProviderDriverKind.make("claudeAgent"), config: { homePath: workHome } },
      [ProviderInstanceId.make("codex")]: {
        driver: ProviderDriverKind.make("codex"),
        enabled: false,
        config: {},
      },
      [ProviderInstanceId.make("pi")]: {
        driver: ProviderDriverKind.make("pi"),
        enabled: false,
        config: {},
      },
    },
  });
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const shared = Layer.mergeAll(
    settings,
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) =>
        Effect.succeed(Option.fromNullishOr(projects.find((entry) => entry.id === id))),
      listPage: () => Effect.succeed({ projects, nextCursor: null }),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadRecords: (threadId, fields) =>
        projections
          .getThreadRecords(threadId, fields)
          .pipe(
            Effect.mapError(
              (cause) => new Orchestrator.OrchestratorProjectionError({ threadId, cause }),
            ),
          ),
    }),
    Layer.succeed(
      ProviderSessionRuntime.ProviderSessionRuntimeRepository,
      yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository,
    ),
  );
  const scanner = AgentSessionScanner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(repo, { prefix: "fork-import-config-" }),
        Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
      ),
    ),
  );
  const importer = AgentSessionImporter.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        scanner,
        Layer.succeed(EventSink.EventSinkV2, yield* EventSink.EventSinkV2),
        Layer.succeed(IdAllocator.IdAllocatorV2, yield* IdAllocator.IdAllocatorV2),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
        Layer.succeed(
          ThreadCommandExecutor.ThreadCommandExecutor,
          yield* ThreadCommandExecutor.make,
        ),
      ),
    ),
  );
  const context = yield* Layer.build(
    ForkAgentSessionImport.layer.pipe(Layer.provide(importer), Layer.provideMerge(shared)),
  );
  return {
    service: Context.get(context, ForkAgentSessionImport.ForkAgentSessionImport),
    personalHome,
    workHome,
    repo,
    otherRoot,
  };
});

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(persistence, NodeServices.layer, SecureRandom.layerWebCrypto)),
  );

describe("ForkAgentSessionImport", () => {
  it.effect("lists sessions newest first and filters them by project, query, and limit", () =>
    provided(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* writeSession({
          home: h.personalHome,
          id: OLD_ID,
          cwd: h.repo,
          text: "Fix the login bug",
          ageDays: 90,
        });
        yield* writeSession({
          home: h.personalHome,
          id: OTHER_ID,
          cwd: h.otherRoot,
          text: "Write the release notes",
          ageDays: 1,
        });

        const all = yield* h.service.list({ providerInstanceId: PERSONAL });
        expect(all.sessions.map((session) => session.sessionId)).toEqual([OTHER_ID, OLD_ID]);
        expect(all.sessions[1]).toMatchObject({
          cwd: h.repo,
          title: "Fix the login bug",
          firstMessage: "Fix the login bug",
          messageCount: 2,
          thread: null,
        });

        const inRepo = yield* h.service.list({
          providerInstanceId: PERSONAL,
          projectId: REPO_PROJECT,
        });
        expect(inRepo.sessions.map((session) => session.sessionId)).toEqual([OLD_ID]);
        const byPath = yield* h.service.list({
          providerInstanceId: PERSONAL,
          workspacePath: h.otherRoot,
        });
        expect(byPath.sessions.map((session) => session.sessionId)).toEqual([OTHER_ID]);
        const byQuery = yield* h.service.list({ providerInstanceId: PERSONAL, query: "LOGIN" });
        expect(byQuery.sessions.map((session) => session.sessionId)).toEqual([OLD_ID]);
        const limited = yield* h.service.list({ providerInstanceId: PERSONAL, limit: 1 });
        expect(limited.sessions.map((session) => session.sessionId)).toEqual([OTHER_ID]);
        expect(limited.truncated).toBe(true);
      }),
    ),
  );

  it.effect("imports one old session through the importer and leaves the others", () =>
    provided(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* writeSession({
          home: h.personalHome,
          id: OLD_ID,
          cwd: h.repo,
          text: "Fix the login bug",
          ageDays: 90,
        });
        yield* writeSession({
          home: h.personalHome,
          id: OTHER_ID,
          cwd: h.repo,
          text: "Other",
          ageDays: 1,
        });

        const first = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: [OLD_ID],
        });
        const threadId = ThreadId.make(`import:${PERSONAL}:${OLD_ID}`);
        expect(first.results).toEqual([
          {
            sessionId: OLD_ID,
            status: "imported",
            threadId,
            title: "Fix the login bug",
            projectId: REPO_PROJECT,
          },
        ]);
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const thread = yield* projections.getThread(threadId);
        expect(thread.providerInstanceId).toBe(PERSONAL);
        const other = yield* Effect.option(
          projections.getThread(ThreadId.make(`import:${PERSONAL}:${OTHER_ID}`)),
        );
        expect(Option.isNone(other)).toBe(true);

        const again = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: [OLD_ID],
        });
        expect(again.results[0]).toMatchObject({ status: "already_imported", threadId });
        const listed = yield* h.service.list({ providerInstanceId: PERSONAL, query: "login" });
        expect(listed.sessions[0]?.thread).toMatchObject({
          threadId,
          imported: true,
          hasRuns: false,
        });

        const conflict = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: [OLD_ID],
          projectId: OTHER_PROJECT,
        });
        expect(conflict.results[0]).toMatchObject({ status: "skipped", threadId });
        expect(conflict.results[0]?.reason).toContain(`belongs to project ${REPO_PROJECT}`);
      }),
    ),
  );

  it.effect("skips a session another thread owns and imports a copy with asCopy", () =>
    provided(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const h = yield* makeHarness();
        const original = yield* writeSession({
          home: h.personalHome,
          id: OLD_ID,
          cwd: h.repo,
          text: "Recover me",
          ageDays: 2,
        });
        const before = yield* fs.readFileString(original);
        const owner = yield* seedNativeOwner(OLD_ID);

        const owned = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: [OLD_ID],
        });
        expect(owned.results[0]).toMatchObject({ status: "skipped", threadId: owner });
        expect(owned.results[0]?.reason).toContain("asCopy");

        const copied = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: [OLD_ID],
          asCopy: true,
          title: "serein (recovered)",
        });
        const copyId = copied.results[0]?.sessionId ?? "";
        expect(copyId).not.toBe(OLD_ID);
        expect(copied.results).toEqual([
          {
            sessionId: copyId,
            copiedFrom: OLD_ID,
            status: "imported",
            threadId: ThreadId.make(`import:${PERSONAL}:${copyId}`),
            title: "serein (recovered)",
            projectId: REPO_PROJECT,
          },
        ]);
        expect(yield* fs.readFileString(original)).toBe(before);
      }),
    ),
  );

  it.effect("keeps a work session on the work instance", () =>
    provided(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* writeSession({
          home: h.workHome,
          id: WORK_ID,
          cwd: h.repo,
          text: "Client work",
          ageDays: 1,
        });

        const personal = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: [WORK_ID],
        });
        expect(personal.results[0]).toMatchObject({ status: "skipped" });
        expect(personal.results[0]?.reason).toBe(
          `No session ${WORK_ID} exists in the sessions of instance claudeAgent.`,
        );
        expect((yield* h.service.list({ providerInstanceId: PERSONAL })).sessions).toEqual([]);

        const work = yield* h.service.importSessions({
          providerInstanceId: WORK,
          sessionIds: [WORK_ID],
        });
        const threadId = ThreadId.make(`import:${WORK}:${WORK_ID}`);
        expect(work.results[0]).toMatchObject({ status: "imported", threadId });
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        expect((yield* projections.getThread(threadId)).providerInstanceId).toBe(WORK);
      }),
    ),
  );

  it.effect("refuses an instance that is not a Claude instance and a bad session id", () =>
    provided(
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const error = yield* h.service
          .list({ providerInstanceId: ProviderInstanceId.make("codex") })
          .pipe(Effect.flip);
        expect(error.message).toBe("Instance codex is not a Claude Code instance.");
        const bad = yield* h.service.importSessions({
          providerInstanceId: PERSONAL,
          sessionIds: ["../x"],
        });
        expect(bad.results[0]).toMatchObject({
          status: "skipped",
          reason: "The session id must be a UUID.",
        });
      }),
    ),
  );
});
