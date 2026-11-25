import { useAtomValue } from "@effect/atom-react";
import { createContext, use, type ReactNode } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import {
  forkTranscriptEditSessionAtom,
  type ForkTranscriptEditSession,
  useForkTranscriptEditActions,
  useForkTranscriptEditSession,
  useForkTranscriptRowState,
} from "./editSession";
import { ForkTranscriptEditForm } from "./ForkTranscriptEditForm";
import { useForkTranscriptEditEnabled } from "./transcriptEditSetting";

/** The id of the timeline row that renders the current subtree. */
export const ForkTranscriptRowIdCtx = createContext<string | null>(null);

const EDIT_BUTTON_SELECTOR = "[data-fork-transcript-edit-button]";

const focusEditButton = (rowId: string) =>
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(
        `[data-timeline-row-id="${CSS.escape(rowId)}"] ${EDIT_BUTTON_SELECTOR}`,
      )
      ?.focus(),
  );

function ForkTranscriptRowForms(props: {
  readonly threadKey: string;
  readonly rowId: string;
  readonly unitKeys: ReadonlyArray<string>;
}) {
  const ctx = use(TimelineRowCtx);
  const session = useForkTranscriptEditSession(props.threadKey);
  const actions = useForkTranscriptEditActions(props.threadKey, ctx.threadRef);
  const units = session.preview?.units ?? session.load?.units ?? [];
  if (session.load === null || ctx.threadRef === null) return null;
  const { load } = session;
  const threadRef = ctx.threadRef;
  return props.unitKeys
    .filter((key) => session.openUnitKeys.has(key))
    .flatMap((key) => {
      const unit = units.find((candidate) => candidate.key === key);
      if (unit === undefined) return [];
      const close = () => {
        actions.closeUnit(key, props.rowId);
        focusEditButton(props.rowId);
      };
      return [
        <div key={key} className="pb-4">
          <ForkTranscriptEditForm
            unit={unit}
            units={units}
            inherited={load.links.some((link) => link.unitKey === key && link.inherited)}
            baseKey={load.baseKey}
            threadRef={threadRef}
            timestampFormat={ctx.timestampFormat}
            onStep={actions.addStep}
            onClose={close}
          />
        </div>,
      ];
    });
}

// The form replaces a message row. Other rows keep their content and show the form below it.
export function ForkTranscriptRowFrame(props: {
  readonly row: MessagesTimelineRow;
  readonly children: ReactNode;
}) {
  const ctx = use(TimelineRowCtx);
  const [enabled] = useForkTranscriptEditEnabled();
  const state = useForkTranscriptRowState(enabled ? ctx.routeThreadKey : null, props.row);
  const showForm = state.open && props.row.kind !== "assistant-meta";
  return (
    <ForkTranscriptRowIdCtx value={props.row.id}>
      {showForm && props.row.kind === "message" ? null : props.children}
      {showForm ? (
        <ForkTranscriptRowForms
          threadKey={ctx.routeThreadKey}
          rowId={props.row.id}
          unitKeys={state.unitKeys}
        />
      ) : null}
    </ForkTranscriptRowIdCtx>
  );
}

const EMPTY_ROW_IDS: ReadonlyArray<string> = [];
const rowIdArrays = new WeakMap<ReadonlySet<string>, ReadonlyArray<string>>();
const openRowIdsOf = (session: ForkTranscriptEditSession) => session.openRowIds;

/** Row ids with an open edit form, so the list never recycles them. */
export const useForkTranscriptAlwaysRenderRowIds = (threadKey: string): ReadonlyArray<string> => {
  const openRowIds = useAtomValue(forkTranscriptEditSessionAtom(threadKey), openRowIdsOf);
  if (openRowIds.size === 0) return EMPTY_ROW_IDS;
  const cached = rowIdArrays.get(openRowIds);
  if (cached !== undefined) return cached;
  const ids = [...openRowIds];
  rowIdArrays.set(openRowIds, ids);
  return ids;
};
