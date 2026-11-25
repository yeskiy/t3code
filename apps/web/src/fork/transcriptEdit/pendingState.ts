import { useAtomValue } from "@effect/atom-react";
import type { ForkTranscriptLoadResult } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { registerThreadOverlay } from "~/components/chat/threadOverlayRetention";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { forkTranscriptEditSessionAtom } from "./editSession";
import { type RowLook, rowLook } from "./pendingLooks.logic";
import { rowProjectedItems } from "./rowUnits.logic";

const PLAIN_LOOK: RowLook = { kind: "plain" };
const PLAIN_LOOK_ATOM = Atom.make(PLAIN_LOOK).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:transcript-edit:look:plain"),
);
const ITEM_SEPARATOR = "\u0001";

const unitKeyMaps = new WeakMap<ForkTranscriptLoadResult, ReadonlyMap<string, string>>();
const unitKeyMapOf = (load: ForkTranscriptLoadResult): ReadonlyMap<string, string> => {
  const cached = unitKeyMaps.get(load);
  if (cached !== undefined) return cached;
  const map = new Map(load.links.map((link) => [link.itemId, link.unitKey] as const));
  unitKeyMaps.set(load, map);
  return map;
};

const lookAtomFamily = Atom.family((compositeKey: string) => {
  const [threadKey = "", rawIds = "", rawNativeIds = ""] = compositeKey.split("\0");
  const itemIds = rawIds.split(ITEM_SEPARATOR);
  const nativeIds = rawNativeIds.split(ITEM_SEPARATOR).map((id) => (id.length === 0 ? null : id));
  const sessionAtom = forkTranscriptEditSessionAtom(threadKey);
  return Atom.make((get): RowLook => {
    const session = get(sessionAtom);
    if (session.load === null || session.preview === null) return PLAIN_LOOK;
    const keyMap = unitKeyMapOf(session.load);
    return rowLook({
      baseUnits: session.load.units,
      preview: session.preview,
      steps: session.history.steps,
      unitKeys: [...new Set(itemIds.flatMap((id) => keyMap.get(id) ?? []))],
      nativeIds,
    });
  }).pipe(
    Atom.withEquality((a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)),
    Atom.withLabel(`fork:transcript-edit:look:${threadKey}`),
  );
});

export const useForkTranscriptRowLook = (
  threadKey: string | null,
  row: MessagesTimelineRow,
): RowLook => {
  const items = rowProjectedItems(row);
  const atom =
    threadKey === null || items.length === 0
      ? PLAIN_LOOK_ATOM
      : lookAtomFamily(
          [
            threadKey,
            items.map((projected) => projected.item.id).join(ITEM_SEPARATOR),
            items
              .map((projected) => projected.item.nativeItemRef?.nativeId ?? "")
              .join(ITEM_SEPARATOR),
          ].join("\0"),
        );
  return useAtomValue(atom);
};

export interface InsertTarget {
  readonly unitKey: string;
  readonly rowId: string;
  readonly position: "above" | "below";
}

const insertTargets = new Map<string, Atom.Writable<InsertTarget | null>>();
const insertTargetFamily = Atom.family((threadKey: string) =>
  Atom.make<InsertTarget | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`fork:transcript-edit:insert:${threadKey}`),
  ),
);

export const forkTranscriptInsertTargetAtom = (
  threadKey: string,
): Atom.Writable<InsertTarget | null> => {
  const existing = insertTargets.get(threadKey);
  if (existing !== undefined) return existing;
  const atom = insertTargetFamily(threadKey);
  insertTargets.set(threadKey, atom);
  return atom;
};

registerThreadOverlay((activeThreadKey) =>
  insertTargets.forEach((atom, threadKey) => {
    if (threadKey !== activeThreadKey && appAtomRegistry.get(atom) !== null) {
      appAtomRegistry.set(atom, null);
    }
  }),
);

const NO_TARGET_ATOM = Atom.make<InsertTarget | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("fork:transcript-edit:insert:none"),
);

/** The open insert composer of one row, or null. */
export const useForkTranscriptInsertTarget = (
  threadKey: string | null,
  rowId: string,
): InsertTarget | null =>
  useAtomValue(
    threadKey === null ? NO_TARGET_ATOM : forkTranscriptInsertTargetAtom(threadKey),
    (target) => (target?.rowId === rowId ? target : null),
  );
