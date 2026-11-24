import type { OrchestrationV2ProviderThread, OrchestrationV2Run } from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export type ForkStopScope = "turn" | "all" | undefined;

const ACTIVE_RUN_STATUSES = new Set<OrchestrationV2Run["status"]>([
  "preparing",
  "starting",
  "running",
]);

export function runCanKeepBackgroundWork(
  run: Pick<OrchestrationV2Run, "status"> | undefined,
  scope: ForkStopScope,
): boolean {
  return scope === "turn" && run !== undefined && ACTIVE_RUN_STATUSES.has(run.status);
}

export function terminalKeepsBackgroundWork(terminal: {
  readonly status: string;
  readonly backgroundWorkContinues?: boolean | undefined;
}): boolean {
  return terminal.status === "interrupted" && terminal.backgroundWorkContinues === true;
}

export const shouldPreserveProviderBackgroundWork = Effect.fn(
  "ForkStopScope.shouldPreserveProviderBackgroundWork",
)(function* <E>(input: {
  readonly scope: "turn" | undefined;
  readonly providerThread: OrchestrationV2ProviderThread | undefined;
  readonly getSession: (
    sessionId: NonNullable<OrchestrationV2ProviderThread["providerSessionId"]>,
  ) => Effect.Effect<Option.Option<ProviderAdapter.ProviderAdapterV2SessionRuntime>, E>;
}) {
  const { scope, providerThread, getSession } = input;
  const sessionId = providerThread?.providerSessionId;
  if (
    scope !== "turn" ||
    providerThread === undefined ||
    sessionId === null ||
    sessionId === undefined
  ) {
    return false;
  }
  const session = yield* getSession(sessionId).pipe(Effect.orElseSucceed(() => Option.none()));
  if (Option.isNone(session)) return false;
  if (session.value.providerSession.capabilities.turns.interruptKeepsBackgroundWork !== true) {
    return false;
  }
  const probe = session.value.hasPendingBackgroundWorkForThread;
  if (probe === undefined) return true;
  return yield* probe(providerThread, { includeSubagents: true }).pipe(
    Effect.orElseSucceed(() => false),
  );
});
