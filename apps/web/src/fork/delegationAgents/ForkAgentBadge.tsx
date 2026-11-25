/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ForkThreadDelegationAgent, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { formatForkAgentRun } from "./delegationAgents.logic";
import { forkThreadDelegationAgent } from "./delegationAgentsQueries";
import { ForkAgentDetails } from "./ForkAgentDetails";

export function ForkAgentBadgeView(props: {
  readonly thread: ForkThreadDelegationAgent;
  readonly renderInstructions: () => ReactNode;
}) {
  const { agent } = props.thread;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Agent: ${agent.name}`}
        render={
          <Badge
            render={<button type="button" />}
            variant={agent.problem ? "warning" : "outline"}
            size="sm"
          />
        }
      >
        {agent.name}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="end">
        <div className="flex flex-col gap-2">
          <PopoverTitle>Agent: {agent.name}</PopoverTitle>
          <ForkAgentDetails
            agent={agent}
            runLabel={formatForkAgentRun(props.thread)}
            renderInstructions={props.renderInstructions}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ForkThreadAgentInstructions(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const result = useAtomValue(
    forkThreadDelegationAgent({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, includeInstructions: true },
    }),
  );
  return result._tag === "Success"
    ? (result.value?.agent.instructions ?? "No agent text.")
    : result._tag === "Failure"
      ? "Could not load the agent text."
      : "Loading...";
}

/** The agent a delegated child thread runs as. Renders nothing for other threads. */
export function ForkAgentBadge(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const result = useAtomValue(
    forkThreadDelegationAgent({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  if (result._tag !== "Success" || result.value === null) return null;
  return (
    <ForkAgentBadgeView
      thread={result.value}
      renderInstructions={() => <ForkThreadAgentInstructions {...props} />}
    />
  );
}
