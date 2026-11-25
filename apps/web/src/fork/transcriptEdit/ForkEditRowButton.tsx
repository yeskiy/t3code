/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { OrchestrationV2ProjectedTurnItem, ScopedThreadRef } from "@t3tools/contracts";
import { PencilIcon } from "lucide-react";
import { use, useContext, type MouseEvent } from "react";

import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { environmentThreadDetails } from "~/state/threads";
import { useV2ItemSupport } from "~/state/v2ItemSupport";
import { editBlock, type EditBlock } from "./editAvailability.logic";
import {
  forkTranscriptEditSessionAtom,
  type ForkTranscriptEditSession,
  useForkTranscriptEditActions,
} from "./editSession";
import { ForkTranscriptRowIdCtx } from "./ForkTranscriptRowFrame";
import { useForkTranscriptEditEnabled } from "./transcriptEditSetting";

// The user and assistant bars reveal their whole cluster on hover. A work row reveals each control.
const WORK_REVEAL_CLASS_NAME =
  "opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/timeline-row:opacity-100";

const BLOCK_TOOLTIP: Record<Exclude<EditBlock, null | "setting-off">, string> = {
  "not-claude": "Transcript editing works for Claude threads only.",
  "not-linked":
    "This entry is not in the session file that was loaded. Save or discard the changes, then try again.",
  locked: "This entry is locked. The session needs it.",
};

const ASSISTANT_META_PREFIX = "assistant-meta:";

// An assistant meta row edits its message row, when that row is mounted.
const formRowId = (rowId: string): string => {
  if (!rowId.startsWith(ASSISTANT_META_PREFIX)) return rowId;
  const messageId = CSS.escape(rowId.slice(ASSISTANT_META_PREFIX.length));
  return (
    document
      .querySelector(`[data-timeline-row-kind="message"][data-message-id="${messageId}"]`)
      ?.getAttribute("data-timeline-row-id") ?? rowId
  );
};

const unitKeyFor = (session: ForkTranscriptEditSession, itemId: string): string | null =>
  session.load?.links.find((link) => link.itemId === itemId)?.unitKey ?? null;

function EditRowButton(props: {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly rowId: string;
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly reveal: "user" | "assistant" | "work";
}) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);
  const registry = useContext(RegistryContext);
  const actions = useForkTranscriptEditActions(props.threadKey, props.threadRef);
  const itemId = props.projectedItem.item.id;
  const support = useV2ItemSupport({
    environmentId: ctx.activeThreadEnvironmentId,
    sourceThreadId: props.projectedItem.sourceThreadId,
    sourceItemId: props.projectedItem.sourceItemId,
  });
  const threadDriver = useAtomValue(
    environmentThreadDetails.threadAtom(props.threadRef),
    (thread) =>
      thread?.projection.providerThreads.find(
        (candidate) => candidate.id === thread.projection.thread.activeProviderThreadId,
      )?.driver ?? null,
  );
  const driver = support.providerThread?.driver ?? support.providerSession?.driver ?? threadDriver;
  const block = useAtomValue(
    forkTranscriptEditSessionAtom(props.threadKey),
    (session): EditBlock => {
      const unitKey = unitKeyFor(session, itemId);
      const notClaude =
        session.error?.code === "not-claude" || session.load?.live.reason === "not-claude";
      return editBlock({
        driver: notClaude ? "not-claude" : driver,
        enabled: true,
        unitKey,
        unit: session.load?.units.find((unit) => unit.key === unitKey),
        loaded: session.load !== null,
      });
    },
  );

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await actions.ensureLoaded();
    const session = registry.get(forkTranscriptEditSessionAtom(props.threadKey));
    if (session.error !== null && session.load === null) {
      toastManager.add({
        type: "error",
        title: "Could not load the transcript",
        description: session.error.detail,
      });
      return;
    }
    const unitKey = unitKeyFor(session, itemId);
    const unit = session.load?.units.find((candidate) => candidate.key === unitKey);
    if (unitKey === null || unit === undefined || unit.locked) return;
    const list = ctx.listRef.current;
    if (list && !(activity.isWorking && list.getState().isFollowingEnd)) {
      list.cancelScroll();
      list.anchorVisibleContent({ key: props.rowId });
    }
    actions.openUnit(unitKey, formRowId(props.rowId));
  };

  return (
    <Tooltip>
      {/* The span keeps the tooltip on a disabled button, and carries the work-row reveal. */}
      <TooltipTrigger
        render={
          <span
            className={cn("flex shrink-0", props.reveal === "work" && WORK_REVEAL_CLASS_NAME)}
          />
        }
      >
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Edit"
          disabled={block !== null}
          data-fork-transcript-edit-button=""
          onClick={(event) => void onClick(event)}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <PencilIcon className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {block === null || block === "setting-off" ? "Edit this entry" : BLOCK_TOOLTIP[block]}
      </TooltipPopup>
    </Tooltip>
  );
}

export function ForkEditRowButton(props: {
  readonly projectedItem: OrchestrationV2ProjectedTurnItem | undefined;
  readonly reveal: "user" | "assistant" | "work";
}) {
  const ctx = use(TimelineRowCtx);
  const rowId = use(ForkTranscriptRowIdCtx);
  const [enabled] = useForkTranscriptEditEnabled();
  if (
    !enabled ||
    props.projectedItem === undefined ||
    rowId === null ||
    ctx.threadRef === null ||
    !ctx.canOperateThread
  ) {
    return null;
  }
  return (
    <EditRowButton
      projectedItem={props.projectedItem}
      rowId={rowId}
      threadKey={ctx.routeThreadKey}
      threadRef={ctx.threadRef}
      reveal={props.reveal}
    />
  );
}
