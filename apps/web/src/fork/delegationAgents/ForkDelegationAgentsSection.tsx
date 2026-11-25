/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ForkAgentDetail } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { forkDelegationAgentsList } from "./delegationAgentsQueries";
import { ForkAgentDetails } from "./ForkAgentDetails";

export type ForkDelegationAgentsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly agents: ReadonlyArray<ForkAgentDetail> };

export function ForkDelegationAgentsList(props: {
  readonly state: ForkDelegationAgentsState;
  readonly renderInstructions: (name: string) => ReactNode;
}) {
  const { state } = props;
  return (
    <SettingsSection id="fork-delegation-agents" title="Delegation agents">
      {state.kind === "loading" ? (
        <SettingsRow title="Loading agents" />
      ) : state.kind === "failed" ? (
        <SettingsRow
          title="Could not load agents"
          description="Check the agent files in the agents folder of the server state directory."
        />
      ) : state.agents.length === 0 ? (
        <SettingsRow
          title="No agents are defined."
          description="Add agent Markdown files to the agents folder of the server state directory."
        />
      ) : (
        state.agents.map((agent) => (
          <SettingsRow key={agent.name} title={agent.name}>
            <ForkAgentDetails
              agent={agent}
              renderInstructions={() => props.renderInstructions(agent.name)}
            />
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}

function ForkAgentInstructions(props: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
}) {
  const result = useAtomValue(
    forkDelegationAgentsList({
      environmentId: props.environmentId,
      input: { includeInstructions: true },
    }),
  );
  return result._tag === "Success"
    ? (result.value.find((agent) => agent.name === props.name)?.instructions ?? "No agent text.")
    : result._tag === "Failure"
      ? "Could not load the agent text."
      : "Loading...";
}

/** Read-only list of the delegation agents that this environment defines. */
export function ForkDelegationAgentsSection(props: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(
    forkDelegationAgentsList({ environmentId: props.environmentId, input: {} }),
  );
  return (
    <ForkDelegationAgentsList
      state={
        result._tag === "Success"
          ? { kind: "ready", agents: result.value }
          : result._tag === "Failure"
            ? { kind: "failed" }
            : { kind: "loading" }
      }
      renderInstructions={(name) => (
        <ForkAgentInstructions environmentId={props.environmentId} name={name} />
      )}
    />
  );
}
