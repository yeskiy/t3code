/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import { MoveVerticalIcon, Trash2Icon } from "lucide-react";
import { use, useContext } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { forkTranscriptEditSessionAtom, useForkTranscriptEditActions } from "./editSession";
import { ForkTranscriptChangeBadge } from "./ForkTranscriptChangeMarker";
import { type RowLook, withoutThinkingRemoval } from "./pendingLooks.logic";

type RemovedLook = Extract<RowLook, { kind: "removed" }>;

const lookKey = (restore: RemovedLook["restore"]): string =>
  restore.kind === "units"
    ? restore.unitKeys.join(" ")
    : restore.blocks.map((ref) => `${ref.uuid}:thinking:${ref.block}`).join(" ");

/** One muted 32 px line in place of a removed or moved-away row. */
export function ForkTranscriptRemovedRow(props: { readonly look: RemovedLook }) {
  const { look } = props;
  const ctx = use(TimelineRowCtx);
  const registry = useContext(RegistryContext);
  const actions = useForkTranscriptEditActions(ctx.routeThreadKey, ctx.threadRef);
  const Icon = look.badge === "Moved" ? MoveVerticalIcon : Trash2Icon;

  const restore = () => {
    if (look.restore.kind === "units") {
      look.restore.unitKeys.forEach((unitKey) =>
        actions.dispatchHistory({ type: "restoreUnit", unitKey }),
      );
      return;
    }
    const { steps } = registry.get(forkTranscriptEditSessionAtom(ctx.routeThreadKey)).history;
    actions.dispatchHistory({
      type: "replace",
      steps: withoutThinkingRemoval(steps, look.restore.blocks),
    });
  };

  return (
    <div className="pb-1">
      <div
        className="flex h-8 min-w-0 items-center gap-2 border-s-2 border-border ps-2 text-xs text-muted-foreground"
        data-fork-transcript-removed={lookKey(look.restore)}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium">{look.label}</span>
        <span className="min-w-0 truncate line-through">{look.excerpt}</span>
        {look.badge === "Moved" ? (
          <span className="min-w-0 shrink truncate">
            {look.movesAfter === null ? "Moves to the start" : `Moves after: ${look.movesAfter}`}
          </span>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-1">
          <ForkTranscriptChangeBadge
            badge={look.badge}
            tone="muted"
            step={look.step}
            failure={null}
          />
          <Button type="button" size="xs" variant="ghost" onClick={restore}>
            Restore
          </Button>
        </span>
      </div>
    </div>
  );
}
