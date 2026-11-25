/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { EyeOffIcon, PencilIcon } from "lucide-react";
import { use } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useForkTranscriptEditActions, useForkTranscriptEditSession } from "./editSession";
import {
  ForkTranscriptChangeBadge,
  ForkTranscriptChangeMarker,
} from "./ForkTranscriptChangeMarker";
import { ForkTranscriptPreviewContent } from "./ForkTranscriptPreviewContent";
import { ForkTranscriptUnitForm } from "./ForkTranscriptUnitForm";
import { draftBadge, newestStepFor } from "./pendingLooks.logic";
import { type DraftAnchor, unitChanges } from "./rowChanges.logic";

const LOCKED_TOOLTIP = "This entry is locked. The session needs it.";

function DraftEditButton(props: { readonly locked: boolean; readonly onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Edit"
          disabled={props.locked}
          data-fork-transcript-edit-button=""
          onClick={props.onClick}
        >
          <PencilIcon className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.locked ? LOCKED_TOOLTIP : "Edit this entry"}</TooltipPopup>
    </Tooltip>
  );
}

/** A unit that has no timeline row of its own: inserted, moved here, or file-only. */
export function ForkTranscriptDraftRow(props: {
  readonly draft: DraftAnchor;
  readonly rowId: string;
}) {
  const { unit, change } = props.draft;
  const ctx = use(TimelineRowCtx);
  const session = useForkTranscriptEditSession(ctx.routeThreadKey);
  const actions = useForkTranscriptEditActions(ctx.routeThreadKey, ctx.threadRef);
  if (session.openUnitKeys.has(unit.key)) {
    return <ForkTranscriptUnitForm rowId={props.rowId} unit={unit} />;
  }
  const badge = draftBadge(change, unit.key, unitChanges(session.preview?.diff ?? []));
  const step = newestStepFor(session.history.steps, [unit.key]);
  const openForm = () => actions.openUnit(unit.key, props.rowId);

  if (change === "fileOnly") {
    return (
      <div className="pb-1" data-fork-transcript-draft={unit.key}>
        <div className="flex h-8 min-w-0 items-center gap-2 border-s-2 border-border ps-2 text-xs text-muted-foreground">
          <EyeOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0">{`Not shown in the timeline: ${unit.kind} entry`}</span>
          <span className="min-w-0 truncate">{unit.excerpt}</span>
          <span className="ms-auto flex shrink-0 items-center gap-1">
            {badge === null ? null : (
              <ForkTranscriptChangeBadge badge={badge} tone="primary" step={step} failure={null} />
            )}
            <DraftEditButton locked={unit.locked} onClick={openForm} />
          </span>
        </div>
      </div>
    );
  }

  const isUser = unit.kind === "user";
  return (
    <div className="pb-4" data-fork-transcript-draft={unit.key}>
      <ForkTranscriptChangeMarker
        badge={badge}
        tone="primary"
        step={step}
        failure={null}
        align={isUser ? "end" : "start"}
      >
        <ForkTranscriptPreviewContent unit={unit} />
        {change === "inserted" ? (
          <div className={cn("flex items-center gap-1 pt-1", isUser && "justify-end")}>
            <DraftEditButton locked={false} onClick={openForm} />
            {step === null ? null : (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => actions.dispatchHistory({ type: "revert", stepId: step.id })}
              >
                Remove
              </Button>
            )}
          </div>
        ) : null}
      </ForkTranscriptChangeMarker>
    </div>
  );
}
