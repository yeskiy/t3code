import {
  type ForkMcpScopes,
  type ProviderInstanceId,
  type ResolvedForkMcpScope,
  isForkMcpToolAllowed,
  resolveForkMcpProviderScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as ServerSettings from "../../serverSettings.ts";

const FAIL_CLOSED_SCOPE: ResolvedForkMcpScope = resolveForkMcpProviderScope({ preset: "off" });

export function applyForkMcpSessionCapabilities(input: {
  readonly forkMcpScopes: ForkMcpScopes;
  readonly providerInstanceId: ProviderInstanceId;
  readonly browserToolsAvailable: boolean;
  readonly deviceToolsAvailable: boolean;
}): {
  readonly enabled: boolean;
  readonly browser: boolean;
  readonly device: boolean;
} {
  const scope = resolveForkMcpProviderScope(input.forkMcpScopes[input.providerInstanceId]);
  if (!scope.enabled) {
    return { enabled: false, browser: false, device: false };
  }
  return {
    enabled: true,
    browser: input.browserToolsAvailable && scope.groups.preview,
    device: input.deviceToolsAvailable && scope.groups.devices,
  };
}

const readForkMcpScopeForProvider = (
  serverSettings: ServerSettings.ServerSettingsService["Service"],
  providerInstanceId: ProviderInstanceId,
): Effect.Effect<ResolvedForkMcpScope> =>
  serverSettings.getSettings.pipe(
    Effect.map((settings) =>
      resolveForkMcpProviderScope(settings.forkMcpScopes[providerInstanceId]),
    ),
    // Unreadable settings must fail closed instead of restoring disabled tools.
    Effect.orElseSucceed(() => FAIL_CLOSED_SCOPE),
  );

export const readOptionalForkMcpScopeForProvider = (
  providerInstanceId: ProviderInstanceId,
): Effect.Effect<ResolvedForkMcpScope | undefined> =>
  Effect.serviceOption(ServerSettings.ServerSettingsService).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.undefined,
        onSome: (serverSettings) => readForkMcpScopeForProvider(serverSettings, providerInstanceId),
      }),
    ),
  );

/**
 * Builds the visibility predicate used by McpHttpServer to enforce per-provider
 * MCP tool scopes on both tools/list and tools/call. Outside clients pass through.
 */
export const makeForkMcpScopeVisibilityCheck = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  // Untraced: runs once per tool on every list and call request.
  return Effect.fnUntraced(function* ({
    method,
    target,
  }: {
    readonly method: string;
    readonly target: string;
  }) {
    if (method !== "tools/list" && method !== "tools/call") return true;
    const invocation = Option.getOrUndefined(
      yield* Effect.serviceOption(McpInvocationContext.McpInvocationContext),
    );
    const providerInstanceId = invocation?.thread?.providerInstanceId;
    if (providerInstanceId === undefined) return true;
    const scope = yield* readForkMcpScopeForProvider(serverSettings, providerInstanceId);
    return isForkMcpToolAllowed(scope, target);
  });
});
