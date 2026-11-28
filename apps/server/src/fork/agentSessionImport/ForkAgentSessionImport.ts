import {
  OrchestratorMcpFailure,
  type Project,
  type ProjectId,
  type ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as AgentSessionImporter from "../../project/AgentSessionImporter.ts";
import * as AgentSessionScanner from "../../project/AgentSessionScanner.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { resolveClaudeHomePath } from "../../provider/Drivers/ClaudeHome.ts";
import * as ServerSettings from "../../serverSettings.ts";
import {
  copySession,
  ForkSessionImportError,
  listSessionFiles,
  resolveSessionFile,
  type SessionFile,
} from "./sessionFiles.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SUMMARIES_READ = 200;
const MAX_SUMMARY_BYTES = 32 * 1024 * 1024;
const CWD_HEAD_BYTES = 256 * 1024;
const PREVIEW_CHARS = 200;
const PROJECT_PAGE = 200;

const ClaudeHomeConfig = Schema.Struct({ homePath: Schema.optional(Schema.String) });
const decodeClaudeHomeConfig = Schema.decodeUnknownOption(ClaudeHomeConfig);
const decodeCwdRecord = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ cwd: Schema.optional(Schema.String) })),
);

export interface SessionThread {
  readonly threadId: ThreadId;
  readonly title: string | null;
  readonly projectId: ProjectId | null;
  readonly imported: boolean;
  readonly hasRuns: boolean;
  readonly deleted: boolean;
}

export interface ListedSession {
  readonly sessionId: string;
  readonly projectFolder: string;
  readonly cwd: string | null;
  readonly title: string | null;
  readonly firstMessage: string | null;
  readonly messageCount: number | null;
  readonly sizeBytes: number;
  readonly lastChangedAt: string;
  readonly thread: SessionThread | null;
}

export interface ImportedSession {
  readonly sessionId: string;
  readonly status: "imported" | "already_imported" | "skipped";
  readonly copiedFrom?: string;
  readonly threadId?: ThreadId;
  readonly title?: string | null;
  readonly projectId?: ProjectId | null;
  readonly reason?: string;
}

export interface ListInput {
  readonly providerInstanceId: ProviderInstanceId;
  readonly projectId?: ProjectId | undefined;
  readonly workspacePath?: string | undefined;
  readonly query?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ImportInput {
  readonly providerInstanceId: ProviderInstanceId;
  readonly sessionIds: ReadonlyArray<string>;
  readonly projectId?: ProjectId | undefined;
  readonly asCopy?: boolean | undefined;
  readonly title?: string | undefined;
}

const refuse = (message: string) => new ForkSessionImportError({ message });
const invalid = (error: ForkSessionImportError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const importThreadId = (instanceId: ProviderInstanceId, sessionId: string) =>
  ThreadId.make(`import:${instanceId}:${sessionId}`);

const isWithinRoot = (cwd: string, root: string): boolean => {
  const folder = normalizeProjectPathForComparison(cwd);
  const base = normalizeProjectPathForComparison(root).replace(/[\\/]+$/, "");
  return folder === base || folder.startsWith(`${base}/`) || folder.startsWith(`${base}\\`);
};

const cwdOf = (line: string): string | undefined =>
  line.includes('"cwd"') ? Option.getOrUndefined(decodeCwdRecord(line))?.cwd : undefined;

const readCwd = (text: string): string | null =>
  text
    .split("\n")
    .map((line) => cwdOf(line))
    .find((cwd) => cwd !== undefined && cwd.trim() !== "") ?? null;

const preview = (text: string | undefined): string | null =>
  text === undefined ? null : text.trim().slice(0, PREVIEW_CHARS);

const skipped = (reason: string, threadId?: ThreadId) => ({
  status: "skipped" as const,
  reason,
  ...(threadId === undefined ? {} : { threadId }),
});

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const importer = yield* AgentSessionImporter.AgentSessionImporter;
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const withPlatform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const resolveConfigDir = Effect.fn("fork.agentSessionImport.resolveConfigDir")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => refuse("The server settings cannot be read.")),
    );
    const instance = current.providerInstances[instanceId];
    const isClaude =
      instance === undefined ? instanceId === "claudeAgent" : instance.driver === "claudeAgent";
    if (!isClaude) return yield* refuse(`Instance ${instanceId} is not a Claude Code instance.`);
    const homePath = Option.match(decodeClaudeHomeConfig(instance?.config), {
      onNone: () => "",
      onSome: (decoded) => decoded.homePath ?? "",
    });
    const environment = yield* mergeProviderInstanceEnvironment(instance?.environment, process.env);
    return yield* resolveClaudeHomePath({ homePath }, environment).pipe(
      Effect.provideService(Path.Path, path),
    );
  });

  const projectById = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(() => refuse("The projects cannot be read.")),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(refuse(`Project ${projectId} does not exist.`)),
          onSome: Effect.succeed,
        }),
      ),
    );

  const allProjects = (
    cursor: number,
  ): Effect.Effect<ReadonlyArray<Project>, ForkSessionImportError> =>
    projects.listPage({ cursor, limit: PROJECT_PAGE }).pipe(
      Effect.mapError(() => refuse("The projects cannot be read.")),
      Effect.flatMap((page) =>
        page.nextCursor === null
          ? Effect.succeed(page.projects)
          : Effect.map(allProjects(page.nextCursor), (rest) => [...page.projects, ...rest]),
      ),
    );

  const projectForCwd = (cwd: string) =>
    Effect.map(
      allProjects(0),
      (all) =>
        all
          .filter((candidate) => isWithinRoot(cwd, candidate.workspaceRoot))
          .toSorted((left, right) => right.workspaceRoot.length - left.workspaceRoot.length)[0] ??
        null,
    );

  const threadInfo = (threadId: ThreadId, importId: ThreadId) =>
    orchestrator.getThreadRecords(threadId, ["runs"]).pipe(
      Effect.map(({ thread, runs }): SessionThread => ({
        threadId,
        title: thread.title,
        projectId: thread.projectId,
        imported: threadId === importId,
        hasRuns: runs.length > 0,
        deleted: thread.deletedAt !== null,
      })),
      Effect.option,
      Effect.map(Option.getOrNull),
    );

  // The same ownership rule the importer's event write applies to a native session.
  const nativeOwner = (instanceId: ProviderInstanceId, sessionId: string) =>
    sql<{ readonly thread_id: string }>`
      SELECT thread_id
      FROM orchestration_v2_projection_provider_threads
      WHERE driver = 'claudeAgent'
        AND provider_instance_id = ${instanceId}
        AND json_extract(payload_json, '$.nativeThreadRef.nativeId') = ${sessionId}
      ORDER BY thread_id
      LIMIT 1
    `.pipe(
      Effect.mapError(() => refuse("The thread store cannot be read.")),
      Effect.map((rows) => (rows[0] === undefined ? null : ThreadId.make(rows[0].thread_id))),
    );

  const sessionThread = Effect.fn("fork.agentSessionImport.sessionThread")(function* (
    instanceId: ProviderInstanceId,
    sessionId: string,
  ) {
    const importId = importThreadId(instanceId, sessionId);
    const imported = yield* threadInfo(importId, importId);
    if (imported !== null) return imported;
    const owner = yield* nativeOwner(instanceId, sessionId);
    if (owner === null) return null;
    return (
      (yield* threadInfo(owner, importId)) ?? {
        threadId: owner,
        title: null,
        projectId: null,
        imported: false,
        hasRuns: false,
        deleted: true,
      }
    );
  });

  const readHead = (filePath: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(filePath, { flag: "r" });
        const bytes = yield* file.readAlloc(CWD_HEAD_BYTES);
        return Option.match(bytes, {
          onNone: () => "",
          onSome: (value) => new TextDecoder().decode(value),
        });
      }),
    ).pipe(Effect.orElseSucceed(() => ""));

  const readSessionCwd = (filePath: string) => Effect.map(readHead(filePath), readCwd);

  const summarize = Effect.fn("fork.agentSessionImport.summarize")(function* (
    instanceId: ProviderInstanceId,
    file: SessionFile,
  ) {
    const text =
      file.size > MAX_SUMMARY_BYTES
        ? null
        : yield* fs.readFileString(file.filePath).pipe(Effect.option, Effect.map(Option.getOrNull));
    const parsed =
      text === null
        ? null
        : AgentSessionScanner.parseAgentSessionTranscript({
            source: "claudeAgent",
            providerInstanceId: instanceId,
            fallbackSessionId: file.sessionId,
            lastActiveAtMs: file.mtimeMs,
            contents: text,
          });
    return {
      sessionId: file.sessionId,
      projectFolder: path.basename(file.folder),
      cwd: text === null ? yield* readSessionCwd(file.filePath) : readCwd(text),
      title: parsed?.title ?? null,
      firstMessage: preview(parsed?.messages.find((message) => message.role === "user")?.text),
      messageCount: parsed === null ? null : parsed.messages.length + parsed.omittedMessageCount,
      sizeBytes: file.size,
      lastChangedAt: DateTime.formatIso(DateTime.makeUnsafe(file.mtimeMs)),
    };
  });

  const list = Effect.fn("fork.agentSessionImport.list")(function* (input: ListInput) {
    const configDir = yield* resolveConfigDir(input.providerInstanceId);
    const root =
      input.projectId === undefined
        ? input.workspacePath
        : (yield* projectById(input.projectId)).workspaceRoot;
    const query = input.query?.trim().toLowerCase() || undefined;
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const files = yield* withPlatform(listSessionFiles(configDir));
    const read = files.slice(
      0,
      root === undefined && query === undefined ? limit : MAX_SUMMARIES_READ,
    );
    const summaries = yield* Effect.forEach(
      read,
      (file) => summarize(input.providerInstanceId, file),
      {
        concurrency: 4,
      },
    );
    const matches = summaries.filter(
      (summary) =>
        (root === undefined || (summary.cwd !== null && isWithinRoot(summary.cwd, root))) &&
        (query === undefined ||
          [summary.title, summary.firstMessage, summary.sessionId].some((value) =>
            value?.toLowerCase().includes(query),
          )),
    );
    const sessions = yield* Effect.forEach(matches.slice(0, limit), (summary) =>
      Effect.map(
        sessionThread(input.providerInstanceId, summary.sessionId),
        (thread): ListedSession => ({ ...summary, thread }),
      ),
    );
    return {
      providerInstanceId: input.providerInstanceId,
      sessions,
      truncated: matches.length > limit || files.length > read.length,
    };
  }, Effect.mapError(invalid));

  const importFile = Effect.fn("fork.agentSessionImport.importFile")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly configDir: string;
    readonly file: SessionFile;
    readonly projectId: ProjectId | undefined;
  }) {
    const cwd = yield* readSessionCwd(input.file.filePath);
    if (cwd === null) return skipped("The session file names no working folder (cwd).");
    const project =
      input.projectId === undefined
        ? yield* projectForCwd(cwd)
        : yield* projectById(input.projectId);
    if (project === null) {
      return skipped(
        `No project root holds the session folder ${cwd}. Pass projectId, or create a project for this folder first.`,
      );
    }
    const threadId = importThreadId(input.instanceId, input.file.sessionId);
    const owner = yield* sessionThread(input.instanceId, input.file.sessionId);
    if (owner !== null && owner.threadId !== threadId) {
      return skipped(
        `Thread ${owner.threadId} already owns this session. Pass asCopy: true to import a copy of it.`,
        owner.threadId,
      );
    }
    if (owner !== null && owner.projectId !== null && owner.projectId !== project.id) {
      return skipped(
        `Thread ${threadId} belongs to project ${owner.projectId}, not ${project.id}.`,
        threadId,
      );
    }
    if (owner?.hasRuns === true) {
      return skipped(
        `Thread ${threadId} has runs after its import, so an import cannot change it.`,
        threadId,
      );
    }
    yield* importer
      .importRecentAgentThreads({ projectId: project.id }, [
        {
          filePath: input.file.filePath,
          cwd,
          providerInstanceId: input.instanceId,
          homePath: input.configDir,
          mtimeMs: input.file.mtimeMs,
        },
      ])
      .pipe(Effect.mapError((error) => refuse(`The import failed: ${error.message}`)));
    const thread = yield* threadInfo(threadId, threadId);
    if (thread === null) {
      return skipped(
        `The importer skipped this session. The folder ${cwd} can be outside project ${project.id}, the session can have no messages, or the file can be too large.`,
      );
    }
    return {
      status: owner === null ? ("imported" as const) : ("already_imported" as const),
      threadId,
      title: thread.title,
      projectId: thread.projectId,
    };
  });

  const importOne = Effect.fn("fork.agentSessionImport.importOne")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly configDir: string;
    readonly sessionId: string;
    readonly projectId: ProjectId | undefined;
    readonly asCopy: boolean;
    readonly title: string | undefined;
  }) {
    const file = yield* withPlatform(
      resolveSessionFile({ configDir: input.configDir, sessionId: input.sessionId }),
    );
    if (file === null) {
      return {
        sessionId: input.sessionId,
        ...skipped(
          `No session ${input.sessionId} exists in the sessions of instance ${input.instanceId}.`,
        ),
      };
    }
    if (!input.asCopy) {
      return {
        sessionId: input.sessionId,
        ...(yield* importFile({ ...input, file })),
      };
    }
    const copy = yield* withPlatform(
      copySession({ file, newSessionId: yield* random.uuidV4(), title: input.title }),
    );
    // A copy that no thread imported stays out of the folder, so a later scan cannot import it.
    const outcome = yield* importFile({ ...input, file: copy }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit) && exit.value.status !== "skipped"
          ? Effect.void
          : fs.remove(copy.filePath).pipe(Effect.ignore),
      ),
    );
    return { sessionId: copy.sessionId, copiedFrom: input.sessionId, ...outcome };
  });

  const importSessions = Effect.fn("fork.agentSessionImport.importSessions")(function* (
    input: ImportInput,
  ) {
    if (input.title !== undefined && input.asCopy !== true) {
      return yield* refuse("Pass title only with asCopy: true.");
    }
    const configDir = yield* resolveConfigDir(input.providerInstanceId);
    if (input.projectId !== undefined) yield* projectById(input.projectId);
    const results = yield* Effect.forEach(input.sessionIds, (sessionId) =>
      importOne({
        instanceId: input.providerInstanceId,
        configDir,
        sessionId,
        projectId: input.projectId,
        asCopy: input.asCopy === true,
        title: input.title,
      }).pipe(
        Effect.catchTags({
          ForkSessionImportError: (error) =>
            Effect.succeed({ sessionId, ...skipped(error.message) }),
        }),
      ),
    );
    return {
      providerInstanceId: input.providerInstanceId,
      results: results as ReadonlyArray<ImportedSession>,
    };
  }, Effect.mapError(invalid));

  return { list, importSessions };
});

export class ForkAgentSessionImport extends Context.Service<
  ForkAgentSessionImport,
  Effect.Success<typeof make>
>()("t3/fork/agentSessionImport/ForkAgentSessionImport") {}

export const layer = Layer.effect(ForkAgentSessionImport, make);
