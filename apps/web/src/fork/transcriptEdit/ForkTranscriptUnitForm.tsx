import { RegistryContext } from "@effect/atom-react";
import type { ForkTranscriptUnitView } from "@t3tools/contracts";
import { use, useContext } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { useForkTranscriptEditActions, useForkTranscriptEditSession } from "./editSession";
import { ForkTranscriptEditForm } from "./ForkTranscriptEditForm";
import { forkTranscriptInsertTargetAtom } from "./pendingState";

const EDIT_BUTTON_SELECTOR = "[data-fork-transcript-edit-button]";

export const focusEditButton = (rowId: string) =>
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(
        `[data-timeline-row-id="${CSS.escape(rowId)}"] ${EDIT_BUTTON_SELECTOR}`,
      )
      ?.focus(),
  );

/** The open edit form of one unit, hosted by the timeline row with the given id. */
export function ForkTranscriptUnitForm(props: {
  readonly rowId: string;
  readonly unit: ForkTranscriptUnitView;
}) {
  const ctx = use(TimelineRowCtx);
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(ctx.routeThreadKey);
  const actions = useForkTranscriptEditActions(ctx.routeThreadKey, ctx.threadRef);
  if (session.load === null || ctx.threadRef === null) return null;
  const { load } = session;
  const { unit } = props;
  return (
    <div className="pb-4">
      <ForkTranscriptEditForm
        unit={unit}
        units={session.preview?.units ?? load.units}
        inherited={load.links.some((link) => link.unitKey === unit.key && link.inherited)}
        baseKey={load.baseKey}
        threadRef={ctx.threadRef}
        timestampFormat={ctx.timestampFormat}
        onStep={actions.addStep}
        onClose={() => {
          actions.closeUnit(unit.key, props.rowId);
          focusEditButton(props.rowId);
        }}
        onInsert={(position) => {
          registry.set(forkTranscriptInsertTargetAtom(ctx.routeThreadKey), {
            unitKey: unit.key,
            rowId: props.rowId,
            position,
          });
          actions.closeUnit(unit.key, props.rowId);
        }}
      />
    </div>
  );
}
