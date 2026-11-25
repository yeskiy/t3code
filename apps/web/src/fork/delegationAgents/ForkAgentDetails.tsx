/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkAgentDetail } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  formatForkAgentDefault,
  formatForkAgentTextSize,
  forkAgentLimitLabels,
} from "./delegationAgents.logic";

export function ForkAgentDetails(props: {
  readonly agent: ForkAgentDetail;
  /** The model the child thread runs with now, for a thread view. */
  readonly runLabel?: string | null | undefined;
  readonly renderInstructions: () => ReactNode;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const { agent } = props;
  const limits = forkAgentLimitLabels(agent.limits);
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    ["Limits", limits.length === 0 ? "none" : limits.join(", ")],
    ["Provider", agent.provider ?? "chosen by the caller"],
    ...(props.runLabel ? [["Runs on", props.runLabel] as const] : []),
    [
      "Model defaults",
      agent.defaults.length === 0
        ? "none"
        : agent.defaults.map((preset) => (
            <span key={preset.driver} className="block">
              {formatForkAgentDefault(preset)}
            </span>
          )),
    ],
    ["Skills", agent.skills.length === 0 ? "none" : agent.skills.join(", ")],
    [
      "Agent text",
      agent.instructionsBytes === undefined
        ? "unavailable"
        : formatForkAgentTextSize(agent.instructionsBytes),
    ],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs">
      {agent.description ? <p className="text-muted-foreground">{agent.description}</p> : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {agent.problem ? <p className="text-destructive">{agent.problem}</p> : null}
      {agent.instructionsBytes === undefined ? null : (
        <div className="flex flex-col gap-2">
          <Button
            size="compact"
            variant="outline"
            className="self-start"
            aria-expanded={showInstructions}
            onClick={() => setShowInstructions((shown) => !shown)}
          >
            {showInstructions ? "Hide instructions" : "Show instructions"}
          </Button>
          {showInstructions ? (
            <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-muted/40 p-2 text-2xs whitespace-pre-wrap text-foreground">
              {props.renderInstructions()}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
