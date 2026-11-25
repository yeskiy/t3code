/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { use, type ReactNode } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { useForkTranscriptEditActions } from "./editSession";
import type { StepRef } from "./pendingLooks.logic";

/** The change badge with a hover card that names the step and can revert it. */
export function ForkTranscriptChangeBadge(props: {
  readonly badge: string;
  readonly tone: "primary" | "destructive" | "muted";
  readonly step: StepRef | null;
  readonly failure: string | null;
}) {
  const ctx = use(TimelineRowCtx);
  const actions = useForkTranscriptEditActions(ctx.routeThreadKey, ctx.threadRef);
  const badge = (
    <Badge
      variant={props.tone === "destructive" ? "error" : "outline"}
      size="sm"
      className="shrink-0"
      data-fork-transcript-badge=""
      {...(props.step === null ? {} : { render: <button type="button" /> })}
    >
      {props.badge}
    </Badge>
  );
  const { step } = props;
  if (step === null) return badge;
  return (
    <Popover>
      <PopoverTrigger openOnHover render={badge} />
      <PopoverPopup side="top" padding="compact" aria-label="Pending change">
        <div className="flex max-w-72 flex-col gap-2 text-xs">
          <p>{`Step ${step.number}: ${step.label}`}</p>
          {props.failure === null ? null : (
            <p className="text-destructive-foreground">{props.failure}</p>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="self-start"
            onClick={() => actions.dispatchHistory({ type: "revert", stepId: step.id })}
          >
            Revert
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** A 2 px rule along the row and a badge line, around the row content. */
export function ForkTranscriptChangeMarker(props: {
  readonly badge: string | null;
  readonly tone: "primary" | "destructive";
  readonly step: StepRef | null;
  readonly failure: string | null;
  readonly align: "start" | "end";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-s-2 ps-2",
        props.tone === "destructive" ? "border-destructive" : "border-primary",
      )}
      data-fork-transcript-marker=""
    >
      {props.badge === null ? null : (
        <div className={cn("flex pb-1", props.align === "end" && "justify-end")}>
          <ForkTranscriptChangeBadge
            badge={props.badge}
            tone={props.tone}
            step={props.step}
            failure={props.failure}
          />
        </div>
      )}
      {props.children}
    </div>
  );
}
