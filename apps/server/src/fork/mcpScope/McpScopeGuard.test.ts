import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  FORK_MCP_CORE_TOOLS,
  FORK_MCP_PRESET_GROUPS,
  FORK_MCP_TOOL_GROUPS,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpServer, Tool, Toolkit } from "effect/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import { AssetSigner } from "../../assets/AssetSigner.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { EnvironmentThemeService } from "../../environmentTheme.ts";
import { GitManager } from "../../git/GitManager.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { IssueService } from "../../issue/IssueService.ts";
import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import { PreviewAutomationBroker } from "../../mcp/PreviewAutomationBroker.ts";
import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import { ProviderAdapterRegistryV2 } from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import { ThreadIssueService } from "../../orchestration-v2/ThreadIssueService.ts";
import { ThreadLaunchService } from "../../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ThreadSearch } from "../../orchestration-v2/ThreadSearch.ts";
import { PeerForwarding } from "../../peer/PeerForwarding.ts";
import { PeerLinkRequests } from "../../peer/PeerLinkRequests.ts";
import { PeerLinks } from "../../peer/PeerLinks.ts";
import { RemoteDelegation } from "../../peer/RemoteDelegation.ts";
import { PreviewManager } from "../../preview/Manager.ts";
import { PreviewBrowser } from "../../preview/PreviewBrowser.ts";
import { ManagedProjectFolders } from "../../project/ManagedProjectFolders.ts";
import { ProjectCloneTracker } from "../../project/ProjectCloneTracker.ts";
import { ProjectService } from "../../project/ProjectService.ts";
import { ProjectSetupScriptRunner } from "../../project/ProjectSetupScriptRunner.ts";
import { DocumentText } from "../../provider/DocumentText.ts";
import { ProviderRegistry } from "../../provider/ProviderRegistry.ts";
import { PullRequestReviewGuideService } from "../../pullRequest/PullRequestReviewGuideService.ts";
import { PullRequestService } from "../../pullRequest/PullRequestService.ts";
import { ScheduledTaskService } from "../../scheduledTasks/ScheduledTaskService.ts";
import { SecretRequests } from "../../secrets/SecretRequests.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { SourceControlRepositoryService } from "../../sourceControl/SourceControlRepositoryService.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { TaskFolders } from "../../workspace/TaskFolders.ts";
import { applyForkMcpSessionCapabilities } from "./McpScopeGuard.ts";

const environmentId = EnvironmentId.make("env-fork-mcp-scope-test");

const toolHandlerServices = Layer.mergeAll(
  Layer.mock(AssetSigner)({}),
  Layer.mock(DeviceService)({}),
  Layer.mock(DocumentText)({}),
  Layer.mock(EnvironmentThemeService)({}),
  Layer.mock(GitVcsDriver)({}),
  Layer.mock(GitWorkflowService)({}),
  Layer.mock(TaskFolders)({}),
  Layer.mock(IssueService)({}),
  Layer.mock(ManagedProjectFolders)({ namedProjectsRoot: "" }),
  Layer.mock(McpProviderSessions)({}),
  Layer.mock(OrchestratorV2)({}),
  Layer.mock(PeerForwarding)({}),
  Layer.mock(PeerLinkRequests)({}),
  Layer.mock(PeerLinks)({}),
  Layer.mock(PreviewAutomationBroker)({}),
  Layer.mock(PreviewBrowser)({}),
  Layer.mock(PreviewManager)({}),
  Layer.mock(ProjectCloneTracker)({}),
  Layer.mock(ProjectService)({}),
  Layer.mock(ProjectSetupScriptRunner)({}),
  Layer.mock(ProviderAdapterRegistryV2)({}),
  Layer.mock(ProviderRegistry)({}),
  Layer.mock(PullRequestReviewGuideService)({}),
  Layer.mock(PullRequestService)({}),
  Layer.mock(GitManager)({}),
  Layer.mock(RemoteDelegation)({}),
  Layer.mock(ScheduledTaskService)({}),
  Layer.mock(SecretRequests)({}),
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-fork-mcp-scope-" }),
  Layer.mock(ServerEnvironment)({}),
  Layer.mock(ServerSecretStore)({}),
  Layer.mock(ServerSettings.ServerSettingsService)({}),
  Layer.mock(SourceControlRepositoryService)({}),
  Layer.mock(ThreadIssueService)({}),
  Layer.mock(ThreadLaunchService)({}),
  Layer.mock(ThreadManagementService)({}),
  Layer.mock(ThreadSearch)({}),
  Layer.mock(VcsStatusBroadcaster)({}),
).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const layerRegisteredTools = Layer.mergeAll(
  McpHttpServer.layerTools,
  McpHttpServer.layerToolSearch,
).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(toolHandlerServices),
);

it.effect("categorizes every tool registered on the T3 MCP server with no extras", () =>
  Effect.gen(function* () {
    const mcp = yield* McpServer.McpServer;
    const registered = mcp.tools.map(({ tool }) => tool.name).toSorted();
    const cataloged = [
      ...FORK_MCP_CORE_TOOLS,
      ...FORK_MCP_TOOL_GROUPS.flatMap((group) => group.tools),
    ].toSorted();
    expect(cataloged).toEqual(registered);
  }).pipe(Effect.provide(layerRegisteredTools)),
);

const makeSampleToolkit = () => {
  const sampleTool = (name: string, description: string) =>
    Tool.make(name, {
      description,
      success: Schema.Struct({ ok: Schema.Boolean }),
      failure: OrchestratorMcpFailure,
      failureMode: "return",
    });
  return Toolkit.make(
    sampleTool("send_to_user", "Send a message to the user."),
    sampleTool("t3_submit_output", "Submit structured output."),
    sampleTool("delegate_task", "Delegate a child task."),
    sampleTool("t3_thread_send", "Send a message to another thread."),
    sampleTool("preview_open", "Open a browser preview tab."),
    sampleTool("request_secret", "Ask the user for a secret."),
  );
};

it.effect("enforces per-provider MCP scopes on tools/list, tools/call, and tool_search", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const codexId = ProviderInstanceId.make("codex");
      const claudeId = ProviderInstanceId.make("claudeAgent");

      const threadScope = (
        token: string,
        providerInstanceId: ProviderInstanceId,
      ): McpInvocationContext.McpThreadInvocationScope => ({
        environmentId,
        requestNamespace: token,
        thread: {
          threadId: ThreadId.make(`thread-${token}`),
          providerSessionId: token,
          providerInstanceId,
        },
        client: undefined,
        capabilities: new Set(["orchestration", "preview", "device"]),
        issuedAt: 1,
      });

      const outsideScope: McpInvocationContext.McpInvocationScope = {
        environmentId,
        requestNamespace: "outside-client",
        thread: undefined,
        client: {
          sessionId: "outside-session",
          label: "Outside agent",
          access: "full-access",
        },
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      };

      const tokenScopes = new Map([
        ["codex-token", threadScope("codex-token", codexId)],
        ["claude-token", threadScope("claude-token", claudeId)],
        ["deferred-codex", threadScope("deferred-codex", codexId)],
      ]);

      const SampleToolkit = makeSampleToolkit();
      const ok = McpToolAccess.reads(() => Effect.succeed({ ok: true }));
      const settingsService = yield* ServerSettings.ServerSettingsService;
      yield* settingsService.updateSettings({
        forkMcpScopes: {
          [codexId]: { preset: "standard" },
        },
      });
      const settingsLayer = Layer.succeed(ServerSettings.ServerSettingsService, settingsService);

      const serverLayer = McpHttpServer.layerMcpTransport(
        Layer.mergeAll(
          McpHttpServer.toolkitRegistration(
            SampleToolkit,
            McpToolAccess.toLayer(SampleToolkit, {
              send_to_user: ok,
              t3_submit_output: ok,
              delegate_task: ok,
              t3_thread_send: ok,
              preview_open: ok,
              request_secret: ok,
            }),
          ),
          McpHttpServer.layerToolSearch,
        ),
      ).pipe(
        Layer.provide(settingsLayer),
        Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
        Layer.provide(
          Layer.mock(McpSessionRegistry.McpSessionRegistry)({
            resolve: (token) => Effect.succeed(tokenScopes.get(token)),
          }),
        ),
        Layer.provide(
          Layer.succeed(McpHttpServer.McpClientAuthenticator, {
            authenticate: (request) =>
              Effect.succeed(
                request.headers.authorization === "Bearer outside-token" ? outsideScope : undefined,
              ),
          }),
        ),
      );

      yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );

      const httpClient = yield* HttpClient.HttpClient;

      const openSession = (token: string, deferred = false) =>
        Effect.gen(function* () {
          const headers = {
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${token}`,
            ...(deferred ? { "t3-tool-exposure": "deferred" } : {}),
          };
          const init = yield* httpClient.post("/mcp", {
            headers,
            body: HttpBody.text(
              `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
              "application/json",
            ),
          });
          const sessionId = init.headers["mcp-session-id"]!;
          const rpc = (method: string, params: object) =>
            httpClient
              .post("/mcp", {
                headers: {
                  ...headers,
                  "mcp-session-id": sessionId,
                  "mcp-protocol-version": "2025-06-18",
                },
                body: HttpBody.text(
                  JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
                  "application/json",
                ),
              })
              .pipe(
                Effect.flatMap((response) => response.text),
                Effect.map((text) =>
                  text
                    .split("\n")
                    .filter((line) => line.startsWith("data: ") || line.startsWith("{"))
                    .map(
                      (line) =>
                        JSON.parse(line.replace(/^data: /u, "")) as {
                          id?: number;
                          result?: {
                            tools?: ReadonlyArray<{ name: string }>;
                            structuredContent?: unknown;
                          };
                          error?: { code: number; message: string };
                        },
                    )
                    .find((message) => message.id === 2)!,
                ),
              );
          return {
            list: () =>
              rpc("tools/list", {}).pipe(
                Effect.map((body) => (body.result?.tools ?? []).map((t) => t.name).toSorted()),
              ),
            call: (name: string, args: object = {}) => rpc("tools/call", { name, arguments: args }),
          };
        });

      const codex = yield* openSession("codex-token");
      const claude = yield* openSession("claude-token");
      const outside = yield* openSession("outside-token");
      const deferredCodex = yield* openSession("deferred-codex", true);

      // Standard for Codex hides delegation and threads, keeps preview, secrets, and core.
      expect(yield* codex.list()).toEqual([
        "preview_open",
        "request_secret",
        "send_to_user",
        "t3_submit_output",
      ]);
      expect((yield* codex.call("preview_open")).result?.structuredContent).toEqual({ ok: true });
      expect((yield* codex.call("delegate_task")).error?.code).toBe(-32602);
      expect((yield* codex.call("t3_thread_send")).error?.code).toBe(-32602);

      // Claude still defaults to Full.
      expect(yield* claude.list()).toEqual([
        "delegate_task",
        "preview_open",
        "request_secret",
        "send_to_user",
        "t3_submit_output",
        "t3_thread_send",
      ]);
      expect((yield* claude.call("delegate_task")).result?.structuredContent).toEqual({ ok: true });

      // Outside client is unaffected by per-provider scopes.
      expect(yield* outside.list()).toEqual([
        "delegate_task",
        "preview_open",
        "request_secret",
        "send_to_user",
        "t3_submit_output",
        "t3_thread_send",
      ]);

      // tool_search on deferring Codex must not return disabled tools.
      const searchDisabled = yield* deferredCodex.call("tool_search", { query: "thread" });
      expect(searchDisabled.result?.structuredContent).toEqual({ tools: [] });
      const searchEnabled = yield* deferredCodex.call("tool_search", { query: "browser" });
      expect(searchEnabled.result?.structuredContent).toEqual({
        tools: [{ name: "preview_open", description: "Open a browser preview tab." }],
      });

      // Live update to Minimal hides preview and secrets immediately on the existing session.
      yield* settingsService.updateSettings({
        forkMcpScopes: { [codexId]: { preset: "minimal" } },
      });
      expect(yield* codex.list()).toEqual(["send_to_user", "t3_submit_output"]);
      expect((yield* codex.call("preview_open")).error?.code).toBe(-32602);
      expect((yield* codex.call("t3_submit_output")).result?.structuredContent).toEqual({
        ok: true,
      });

      // Live update to Off hides and blocks every tool including core tools.
      yield* settingsService.updateSettings({
        forkMcpScopes: { [codexId]: { preset: "off" } },
      });
      expect(yield* codex.list()).toEqual([]);
      expect((yield* codex.call("send_to_user")).error?.code).toBe(-32602);
      expect((yield* codex.call("t3_submit_output")).error?.code).toBe(-32602);

      // Resetting back to Full restores all tools immediately.
      yield* settingsService.updateSettings({
        forkMcpScopes: { [codexId]: null },
      });
      expect(yield* codex.list()).toEqual([
        "delegate_task",
        "preview_open",
        "request_secret",
        "send_to_user",
        "t3_submit_output",
        "t3_thread_send",
      ]);
      expect((yield* codex.call("delegate_task")).result?.structuredContent).toEqual({ ok: true });
    }).pipe(Effect.provide(ServerSettings.layerTest())),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it("maps provider MCP scopes to session capabilities and off state", () => {
  const codexId = ProviderInstanceId.make("codex");
  expect(
    applyForkMcpSessionCapabilities({
      forkMcpScopes: {},
      providerInstanceId: codexId,
      browserToolsAvailable: true,
      deviceToolsAvailable: true,
    }),
  ).toEqual({ enabled: true, browser: true, device: true });

  expect(
    applyForkMcpSessionCapabilities({
      forkMcpScopes: { [codexId]: { preset: "off" } },
      providerInstanceId: codexId,
      browserToolsAvailable: true,
      deviceToolsAvailable: true,
    }),
  ).toEqual({ enabled: false, browser: false, device: false });

  expect(
    applyForkMcpSessionCapabilities({
      forkMcpScopes: {
        [codexId]: {
          preset: "custom",
          groups: { ...FORK_MCP_PRESET_GROUPS.full, preview: false },
        },
      },
      providerInstanceId: codexId,
      browserToolsAvailable: true,
      deviceToolsAvailable: true,
    }),
  ).toEqual({ enabled: true, browser: false, device: true });
});
