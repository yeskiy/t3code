import {
  OrchestratorMcpFailure,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
  clampedPositiveInt,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkDelegationAgents } from "../delegationAgents/ForkDelegationAgents.ts";
import { ForkAgentSessionImport } from "./ForkAgentSessionImport.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ForkAgentSessionImport,
    ForkDelegationAgents,
    ThreadManagementService.ThreadManagementService,
  ],
};

const instance = Schema.optional(
  ProviderInstanceId.annotate({
    description:
      "Claude instance whose sessions to use. Only this thread's own instance is allowed, which is the default.",
  }),
);

const SessionThread = Schema.Struct({
  threadId: ThreadId,
  link: Schema.String,
  title: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId),
  imported: Schema.Boolean,
  hasRuns: Schema.Boolean,
  deleted: Schema.Boolean,
});

const SessionImportListTool = Tool.make("t3_session_import_list", {
  ...shared,
  description:
    "List Claude Code session files that can become T3 threads, newest first. Filter by `projectId`, `workspacePath`, or `query` (title or first message). `thread` shows the T3 thread that already holds a session. Import one with `t3_session_import`.",
  parameters: Schema.Struct({
    providerInstanceId: instance,
    projectId: Schema.optional(ProjectId),
    workspacePath: Schema.optional(TrimmedNonEmptyString),
    query: Schema.optional(TrimmedNonEmptyString),
    limit: Schema.optional(clampedPositiveInt(100)),
  }),
  success: Schema.Struct({
    providerInstanceId: ProviderInstanceId,
    sessions: Schema.Array(
      Schema.Struct({
        sessionId: Schema.String,
        projectFolder: Schema.String,
        cwd: Schema.NullOr(Schema.String),
        title: Schema.NullOr(Schema.String),
        firstMessage: Schema.NullOr(Schema.String),
        messageCount: Schema.NullOr(Schema.Number),
        sizeBytes: Schema.Number,
        lastChangedAt: Schema.String,
        thread: Schema.NullOr(SessionThread),
      }),
    ),
    truncated: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const SessionImportTool = Tool.make("t3_session_import", {
  ...shared,
  description:
    "Import Claude Code sessions by id as T3 threads on the session's own instance. Default project: the one whose root holds the session cwd. Use `asCopy: true` when another thread owns the session or its thread broke: it imports a copy under a new id, with an optional `title`. The original file never changes.",
  parameters: Schema.Struct({
    sessionIds: Schema.Array(TrimmedNonEmptyString).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20),
    ),
    providerInstanceId: instance,
    projectId: Schema.optional(ProjectId),
    asCopy: Schema.optional(Schema.Boolean),
    title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  }),
  success: Schema.Struct({
    providerInstanceId: ProviderInstanceId,
    results: Schema.Array(
      Schema.Struct({
        sessionId: Schema.String,
        status: Schema.Literals(["imported", "already_imported", "skipped"]),
        copiedFrom: Schema.optionalKey(Schema.String),
        threadId: Schema.optionalKey(ThreadId),
        link: Schema.optionalKey(Schema.String),
        title: Schema.optionalKey(Schema.NullOr(Schema.String)),
        projectId: Schema.optionalKey(Schema.NullOr(ProjectId)),
        reason: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ForkAgentSessionImportToolkit = Toolkit.make(SessionImportListTool, SessionImportTool);
