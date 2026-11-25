/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { ForkTranscriptValidation, ScopedThreadRef } from "@t3tools/contracts";
import { CircleAlertIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useContext, type RefObject } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useForkTranscriptEditActions, useForkTranscriptEditSession } from "./editSession";
import { patchSaveBar, useForkTranscriptSaveBarState } from "./saveFlow";
import { stepRows, timelineRowIndexForUnit } from "./stepRows.logic";

const plural = (count: number, one: string, other: string) =>
  `${count} ${count === 1 ? one : other}`;

function IssueList(props: {
  readonly tone: "error" | "warning";
  readonly issues: ForkTranscriptValidation["errors"];
}) {
  if (props.issues.length === 0) return null;
  const Icon = props.tone === "error" ? CircleAlertIcon : TriangleAlertIcon;
  return (
    <section className="flex flex-col gap-1 border-t pt-2">
      <h3
        className={
          props.tone === "error"
            ? "flex items-center gap-1.5 text-xs font-medium text-destructive"
            : "flex items-center gap-1.5 text-xs font-medium text-warning-foreground"
        }
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {props.tone === "error"
          ? plural(props.issues.length, "error", "errors")
          : plural(props.issues.length, "warning", "warnings")}
      </h3>
      <ul className="flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
        {props.issues.map((issue) => (
          <li key={`${issue.code}:${issue.uuid ?? ""}:${issue.message}`} className="wrap-anywhere">
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ForkTranscriptChangesPopover(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly listRef: RefObject<LegendListRef | null>;
}) {
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(props.threadKey);
  const actions = useForkTranscriptEditActions(props.threadKey, props.threadRef);
  const bar = useForkTranscriptSaveBarState(props.threadKey);
  const steps = session.history.steps;
  const validation = session.preview?.validation ?? session.load?.validation;
  const rows = stepRows({
    steps,
    previewUnits: session.preview?.units ?? [],
    loadUnits: session.load?.units ?? [],
    failedAt: session.preview?.failedAt ?? null,
  });

  const scrollToUnit = (unitKey: string | null) => {
    const list = props.listRef.current;
    if (unitKey === null || list === null || session.load === null) return;
    const index = timelineRowIndexForUnit(
      list.getState().data as ReadonlyArray<MessagesTimelineRow>,
      session.load.links,
      unitKey,
    );
    if (index < 0) return;
    patchSaveBar(registry, props.threadKey, { popover: null });
    void list.scrollToIndex({
      index,
      animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      viewPosition: 0.3,
    });
  };

  return (
    <Popover
      open={bar.popover !== null}
      onOpenChange={(open) =>
        patchSaveBar(registry, props.threadKey, { popover: open ? "changes" : null })
      }
    >
      <PopoverTrigger render={<Button size="xs" variant="ghost" className="-ml-2" />}>
        <span className="font-medium tabular-nums">
          {steps.length === 0
            ? "No pending changes"
            : plural(steps.length, "pending change", "pending changes")}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" width="lg" padding="compact">
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            Pending changes. Nothing is written until you save.
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending changes.</p>
          ) : (
            <ol className="-mx-1 flex max-h-72 flex-col overflow-y-auto">
              {rows.map((row, index) => (
                <li key={row.id} className="flex items-start gap-1 rounded-md hover:bg-accent/60">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-1 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onClick={() => scrollToUnit(row.unitKey)}
                  >
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <span className="font-medium">{row.label}</span>
                    </span>
                    {row.excerpt.length > 0 ? (
                      <span className="truncate pl-6 text-xs text-muted-foreground">
                        {row.excerpt}
                      </span>
                    ) : null}
                    {row.failed === null ? null : (
                      <span className="pl-6 text-xs text-destructive wrap-anywhere">
                        Cannot apply: {row.failed}
                      </span>
                    )}
                  </button>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          className="mt-1"
                          aria-label={`Revert: ${row.label}`}
                          onClick={() =>
                            actions.dispatchHistory({ type: "revert", stepId: row.id })
                          }
                        />
                      }
                    >
                      <RotateCcwIcon />
                    </TooltipTrigger>
                    <TooltipPopup side="top">Revert this change</TooltipPopup>
                  </Tooltip>
                </li>
              ))}
            </ol>
          )}
          <div
            ref={(node) => {
              if (bar.popover === "errors") node?.scrollIntoView({ block: "nearest" });
            }}
            className="flex flex-col gap-2"
          >
            <IssueList tone="error" issues={validation?.errors ?? []} />
            <IssueList tone="warning" issues={validation?.warnings ?? []} />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
