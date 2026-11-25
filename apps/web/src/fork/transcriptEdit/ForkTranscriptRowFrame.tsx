import { useAtomValue } from "@effect/atom-react";
import { createContext, use, type ReactNode } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import {
  forkTranscriptEditSessionAtom,
  type ForkTranscriptEditSession,
  useForkTranscriptEditSession,
  useForkTranscriptRowState,
} from "./editSession";
import { ForkTranscriptChangeMarker } from "./ForkTranscriptChangeMarker";
import { ForkTranscriptDraftRow } from "./ForkTranscriptDraftRow";
import { ForkTranscriptInsertComposer } from "./ForkTranscriptInsertComposer";
import { ForkTranscriptRemovedRow } from "./ForkTranscriptRemovedRow";
import { ForkTranscriptSelectable, type SelectedState } from "./ForkTranscriptRowCheckbox";
import { ForkTranscriptUnitForm } from "./ForkTranscriptUnitForm";
import type { RowLook } from "./pendingLooks.logic";
import {
  forkTranscriptInsertTargetAtom,
  type InsertTarget,
  useForkTranscriptInsertTarget,
  useForkTranscriptRowLook,
} from "./pendingState";
import type { DraftAnchor } from "./rowChanges.logic";
import { useForkTranscriptEditEnabled } from "./transcriptEditSetting";

/** The id of the timeline row that renders the current subtree. */
export const ForkTranscriptRowIdCtx = createContext<string | null>(null);

function ForkTranscriptRowForms(props: {
  readonly threadKey: string;
  readonly rowId: string;
  readonly unitKeys: ReadonlyArray<string>;
}) {
  const session = useForkTranscriptEditSession(props.threadKey);
  const units = session.preview?.units ?? session.load?.units ?? [];
  return props.unitKeys
    .filter((key) => session.openUnitKeys.has(key))
    .flatMap((key) => {
      const unit = units.find((candidate) => candidate.key === key);
      return unit === undefined
        ? []
        : [<ForkTranscriptUnitForm key={key} rowId={props.rowId} unit={unit} />];
    });
}

const withPreviewText = (row: MessagesTimelineRow, look: RowLook): MessagesTimelineRow =>
  row.kind === "message" && look.kind === "marker" && look.previewText !== null
    ? { ...row, message: { ...row.message, text: look.previewText } }
    : row;

function RowBody(props: {
  readonly row: MessagesTimelineRow;
  readonly look: RowLook;
  readonly render: (row: MessagesTimelineRow) => ReactNode;
}) {
  const { row, look } = props;
  const previewRow = withPreviewText(row, look);
  if (look.kind === "removed") {
    return row.kind === "assistant-meta" ? null : <ForkTranscriptRemovedRow look={look} />;
  }
  if (look.kind === "plain") return props.render(row);
  return (
    <ForkTranscriptChangeMarker
      badge={row.kind === "assistant-meta" ? null : look.badge}
      tone={look.tone}
      step={look.step}
      failure={look.failure}
      align={row.kind === "message" && row.message.role === "user" ? "end" : "start"}
    >
      {props.render(previewRow)}
    </ForkTranscriptChangeMarker>
  );
}

const NO_KEYS: ReadonlyArray<string> = [];

function DraftSelectable(props: {
  readonly threadKey: string;
  readonly draft: DraftAnchor;
  readonly rowId: string;
}) {
  const { unit, change } = props.draft;
  const session = useForkTranscriptEditSession(props.threadKey);
  const keys = change === "removed" ? NO_KEYS : [unit.key];
  return (
    <ForkTranscriptSelectable
      active={session.selectMode}
      itemId={`draft:${unit.key}`}
      rowId={props.rowId}
      unitKeys={keys}
      selectableKeys={unit.locked ? NO_KEYS : keys}
      selected={session.selection.keys.has(unit.key) ? "all" : "none"}
    >
      <ForkTranscriptDraftRow draft={props.draft} rowId={props.rowId} />
    </ForkTranscriptSelectable>
  );
}

function Drafts(props: {
  readonly threadKey: string;
  readonly drafts: ReadonlyArray<DraftAnchor>;
  readonly rowId: string;
  readonly insert: InsertTarget | null;
}) {
  const composer = (position: InsertTarget["position"], unitKey: string) =>
    props.insert?.position === position && props.insert.unitKey === unitKey ? (
      <ForkTranscriptInsertComposer target={props.insert} />
    ) : null;
  return props.drafts.map((draft) => (
    <div key={`${draft.change}:${draft.unit.key}`}>
      {composer("above", draft.unit.key)}
      <DraftSelectable threadKey={props.threadKey} draft={draft} rowId={props.rowId} />
      {composer("below", draft.unit.key)}
    </div>
  ));
}

// The form replaces a message row. Other rows keep their content and show the form below it.
export function ForkTranscriptRowFrame(props: {
  readonly row: MessagesTimelineRow;
  readonly children: (row: MessagesTimelineRow) => ReactNode;
}) {
  const { row } = props;
  const ctx = use(TimelineRowCtx);
  const [enabled] = useForkTranscriptEditEnabled();
  const threadKey = enabled ? ctx.routeThreadKey : null;
  const state = useForkTranscriptRowState(threadKey, row);
  const look = useForkTranscriptRowLook(threadKey, row);
  const insert = useForkTranscriptInsertTarget(threadKey, row.id);
  const showForm = state.open && row.kind !== "assistant-meta";
  const draftKeys = new Set(state.drafts.map((draft) => draft.unit.key));
  const rowInsert = insert !== null && !draftKeys.has(insert.unitKey) ? insert : null;
  // A removed look and the meta row under an assistant message take no checkbox.
  const rowKeys =
    look.kind === "removed" || row.kind === "assistant-meta" ? NO_KEYS : state.unitKeys;
  const selected: SelectedState = rowKeys.length === 0 ? "none" : state.selected;
  return (
    <ForkTranscriptRowIdCtx value={row.id}>
      <Drafts
        threadKey={ctx.routeThreadKey}
        drafts={state.drafts.filter((draft) => draft.afterUnitKey === null)}
        rowId={row.id}
        insert={insert}
      />
      {rowInsert?.position === "above" ? (
        <ForkTranscriptInsertComposer target={rowInsert} rowUnitKeys={state.unitKeys} />
      ) : null}
      <ForkTranscriptSelectable
        active={threadKey !== null && state.selectMode}
        itemId={`row:${row.id}`}
        rowId={row.id}
        unitKeys={rowKeys}
        selectableKeys={rowKeys.length === 0 ? NO_KEYS : state.selectableKeys}
        selected={selected}
      >
        {showForm && row.kind === "message" ? null : (
          <RowBody row={row} look={look} render={props.children} />
        )}
        {showForm ? (
          <ForkTranscriptRowForms
            threadKey={ctx.routeThreadKey}
            rowId={row.id}
            unitKeys={state.unitKeys}
          />
        ) : null}
      </ForkTranscriptSelectable>
      {rowInsert?.position === "below" ? (
        <ForkTranscriptInsertComposer target={rowInsert} rowUnitKeys={state.unitKeys} />
      ) : null}
      <Drafts
        threadKey={ctx.routeThreadKey}
        drafts={state.drafts.filter((draft) => draft.afterUnitKey !== null)}
        rowId={row.id}
        insert={insert}
      />
    </ForkTranscriptRowIdCtx>
  );
}

const EMPTY_ROW_IDS: ReadonlyArray<string> = [];
const rowIdArrays = new WeakMap<ReadonlySet<string>, ReadonlyArray<string>>();
const openRowIdsOf = (session: ForkTranscriptEditSession) => session.openRowIds;
const insertRowIdOf = (target: InsertTarget | null) => target?.rowId ?? null;

/** Row ids with an open edit form or insert composer, so the list never recycles them. */
export const useForkTranscriptAlwaysRenderRowIds = (threadKey: string): ReadonlyArray<string> => {
  const openRowIds = useAtomValue(forkTranscriptEditSessionAtom(threadKey), openRowIdsOf);
  const insertRowId = useAtomValue(forkTranscriptInsertTargetAtom(threadKey), insertRowIdOf);
  const formRowIds = (() => {
    if (openRowIds.size === 0) return EMPTY_ROW_IDS;
    const cached = rowIdArrays.get(openRowIds);
    if (cached !== undefined) return cached;
    const ids = [...openRowIds];
    rowIdArrays.set(openRowIds, ids);
    return ids;
  })();
  return insertRowId === null || formRowIds.includes(insertRowId)
    ? formRowIds
    : [...formRowIds, insertRowId];
};
