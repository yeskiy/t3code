import {
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  type ProviderThreadId,
  type RunId,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { activePath, blocks, buildUnits, byUuid, type Unit } from "./core/model.ts";
import { applyOp, type InsertOp, type Op } from "./core/ops.ts";
import type { Entry, Transcript } from "./core/types.ts";
import { itemForEntryText, mapUnitsToItems, type MappedUnit } from "./itemMap.ts";

export interface PositionChange {
  readonly turnItemId: TurnItemId;
  readonly ordinal: number;
  readonly insert: boolean;
}

export interface MirrorPlan {
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly positions: ReadonlyArray<PositionChange>;
  readonly unmappedUnits: number;
  readonly inheritedUnits: number;
}

type MirrorState = {
  readonly transcript: Transcript;
  readonly allItems: ReadonlyMap<TurnItemId, OrchestrationV2TurnItem>;
  readonly allMessages: ReadonlyMap<MessageId, OrchestrationV2ConversationMessage>;
  readonly dirtyItemIds: ReadonlySet<TurnItemId>;
  readonly dirtyMessageIds: ReadonlySet<MessageId>;
  readonly positionChangedIds: ReadonlySet<TurnItemId>;
  readonly unmappedUnits: number;
  readonly inheritedUnits: number;
};

type MirrorContext = {
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  readonly now: DateTime.Utc;
  readonly newId: (seed: string) => string;
};

const RUN_ORDINAL_STRIDE = 1_000_000;
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const THINKING_BLOCK_TYPES = new Set(["thinking", "redacted_thinking"]);

const entryText = (entry: Entry | undefined): string => {
  if (entry === undefined) return "";
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  return blocks(entry)
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string" ? [block.text] : [],
    )
    .join("");
};

const setItem = (
  state: MirrorState,
  item: OrchestrationV2TurnItem,
  positionChanged = false,
): MirrorState => {
  const allItems = new Map(state.allItems);
  allItems.set(item.id, item);
  const dirtyItemIds = new Set(state.dirtyItemIds);
  dirtyItemIds.add(item.id);
  const positionChangedIds = positionChanged
    ? new Set([...state.positionChangedIds, item.id])
    : state.positionChangedIds;
  return { ...state, allItems, dirtyItemIds, positionChangedIds };
};

const setMessage = (
  state: MirrorState,
  message: OrchestrationV2ConversationMessage,
): MirrorState => {
  const allMessages = new Map(state.allMessages);
  allMessages.set(message.id, message);
  const dirtyMessageIds = new Set(state.dirtyMessageIds);
  dirtyMessageIds.add(message.id);
  return { ...state, allMessages, dirtyMessageIds };
};

const updateMessageText = (
  state: MirrorState,
  messageId: MessageId,
  text: string,
  ctx: MirrorContext,
): MirrorState => {
  const message = state.allMessages.get(messageId);
  if (message === undefined || message.threadId !== ctx.threadId) return state;
  return setMessage(state, { ...message, text, updatedAt: ctx.now });
};

const shiftRange = (
  state: MirrorState,
  insertOrdinal: number,
  shiftBy: number,
  ctx: MirrorContext,
): MirrorState => {
  const targetRange = Math.floor(insertOrdinal / RUN_ORDINAL_STRIDE);
  const toShift = [...state.allItems.values()].filter(
    (item) =>
      item.threadId === ctx.threadId &&
      Math.floor(item.ordinal / RUN_ORDINAL_STRIDE) === targetRange &&
      item.ordinal >= insertOrdinal,
  );
  return toShift.reduce(
    (acc, item) =>
      setItem(acc, { ...item, ordinal: item.ordinal + shiftBy, updatedAt: ctx.now }, true),
    state,
  );
};

const visibleOwnItems = (
  unit: Unit,
  map: ReadonlyMap<string, MappedUnit>,
  allItems: ReadonlyMap<TurnItemId, OrchestrationV2TurnItem>,
  threadId: ThreadId,
): ReadonlyArray<OrchestrationV2TurnItem> => {
  const mapped = map.get(unit.key);
  if (mapped === undefined) return [];
  return mapped.itemIds
    .flatMap((id) => {
      const item = allItems.get(id);
      return item !== undefined && item.threadId === threadId && item.forkTranscriptHidden !== true
        ? [item]
        : [];
    })
    .toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
};

const resolvePlacement = (
  beforeUnits: ReadonlyArray<Unit>,
  afterUnits: ReadonlyArray<Unit>,
  map: ReadonlyMap<string, MappedUnit>,
  allItems: ReadonlyMap<TurnItemId, OrchestrationV2TurnItem>,
  threadId: ThreadId,
): { readonly runId: RunId | null; readonly ordinal: number } => {
  const prevItems = [...beforeUnits]
    .toReversed()
    .map((unit) => visibleOwnItems(unit, map, allItems, threadId))
    .find((items) => items.length > 0);
  const lastPrev = prevItems?.at(-1);
  if (lastPrev !== undefined) {
    return { runId: lastPrev.runId, ordinal: lastPrev.ordinal + 1 };
  }

  const nextItems = afterUnits
    .map((unit) => visibleOwnItems(unit, map, allItems, threadId))
    .find((items) => items.length > 0);
  const firstNext = nextItems?.[0];
  if (firstNext !== undefined) {
    return { runId: firstNext.runId, ordinal: firstNext.ordinal };
  }

  return { runId: null, ordinal: 1 };
};

const mirrorEditText = (
  state: MirrorState,
  nextTranscript: Transcript,
  uuid: string,
  type: "user_message" | "assistant_message",
  ctx: MirrorContext,
): MirrorState => {
  const currentItems = [...state.allItems.values()];
  const map = mapUnitsToItems({
    transcript: state.transcript,
    items: currentItems,
    threadId: ctx.threadId,
  });
  const target = itemForEntryText(map, currentItems, uuid, type);
  if (target === undefined) {
    return { ...state, unmappedUnits: state.unmappedUnits + 1 };
  }
  if (target.threadId !== ctx.threadId) {
    return { ...state, inheritedUnits: state.inheritedUnits + 1 };
  }
  const text = entryText(byUuid(nextTranscript).get(uuid));
  if (target.type === "user_message") {
    const withItem = setItem(state, { ...target, text, updatedAt: ctx.now });
    return updateMessageText(withItem, target.messageId, text, ctx);
  }
  if (target.type === "assistant_message") {
    const withItem = setItem(state, { ...target, text, updatedAt: ctx.now });
    return updateMessageText(withItem, target.messageId, text, ctx);
  }
  return state;
};

const mirrorEditSystem = (
  state: MirrorState,
  uuid: string,
  content: string,
  ctx: MirrorContext,
): MirrorState => {
  const currentItems = [...state.allItems.values()];
  const map = mapUnitsToItems({
    transcript: state.transcript,
    items: currentItems,
    threadId: ctx.threadId,
  });
  const mapped = map.get(uuid);
  if (mapped === undefined || mapped.itemIds.length === 0) {
    return { ...state, unmappedUnits: state.unmappedUnits + 1 };
  }
  const items = mapped.itemIds.flatMap((id) => {
    const item = state.allItems.get(id);
    return item !== undefined ? [item] : [];
  });
  const hasInherited = items.some((item) => item.threadId !== ctx.threadId);
  const ownItems = items.filter((item) => item.threadId === ctx.threadId);
  const baseState = hasInherited ? { ...state, inheritedUnits: state.inheritedUnits + 1 } : state;
  return ownItems.reduce((acc, item) => {
    if (item.type === "system_notice") {
      return setItem(acc, { ...item, message: content, updatedAt: ctx.now });
    }
    return acc;
  }, baseState);
};

const mirrorRemoveThinking = (
  state: MirrorState,
  target: "all" | { readonly uuid: string; readonly block: number },
  ctx: MirrorContext,
): MirrorState => {
  const currentItems = [...state.allItems.values()];
  const map = mapUnitsToItems({
    transcript: state.transcript,
    items: currentItems,
    threadId: ctx.threadId,
  });

  if (target === "all") {
    const groups = [...map.values()]
      .map((mapped) =>
        mapped.itemIds.flatMap((id) => {
          const item = state.allItems.get(id);
          return item !== undefined &&
            item.type === "reasoning" &&
            item.forkTranscriptHidden !== true
            ? [item]
            : [];
        }),
      )
      .filter((reasoning) => reasoning.length > 0);
    const inheritedCount = groups.filter((reasoning) =>
      reasoning.some((item) => item.threadId !== ctx.threadId),
    ).length;
    const ownItems = groups.flatMap((reasoning) =>
      reasoning.filter((item) => item.threadId === ctx.threadId),
    );
    const hidden = ownItems.reduce(
      (acc, item) => setItem(acc, { ...item, forkTranscriptHidden: true, updatedAt: ctx.now }),
      state,
    );
    return inheritedCount === 0
      ? hidden
      : { ...hidden, inheritedUnits: hidden.inheritedUnits + inheritedCount };
  }

  const entry = byUuid(state.transcript).get(target.uuid);
  const thinkingOrdinal = blocks(entry ?? {})
    .slice(0, target.block)
    .filter((block) => THINKING_BLOCK_TYPES.has(block.type)).length;
  const candidateIds = new Set([
    `${target.uuid}:thinking:${target.block}`,
    `${target.uuid}:thinking:${thinkingOrdinal}`,
  ]);
  const mappedItems = [...map.values()]
    .flatMap((unit) => unit.itemIds)
    .flatMap((id) => {
      const item = state.allItems.get(id);
      return item !== undefined ? [item] : [];
    });
  const match = mappedItems.find(
    (item) =>
      item.type === "reasoning" &&
      item.nativeItemRef?.driver === "claudeAgent" &&
      item.nativeItemRef.nativeId !== null &&
      candidateIds.has(item.nativeItemRef.nativeId),
  );
  if (match === undefined) {
    return { ...state, unmappedUnits: state.unmappedUnits + 1 };
  }
  if (match.threadId !== ctx.threadId) {
    return { ...state, inheritedUnits: state.inheritedUnits + 1 };
  }
  return setItem(state, { ...match, forkTranscriptHidden: true, updatedAt: ctx.now });
};

const mirrorDeleteUnits = (
  state: MirrorState,
  unitKeys: ReadonlyArray<string>,
  ctx: MirrorContext,
): MirrorState => {
  const currentItems = [...state.allItems.values()];
  const map = mapUnitsToItems({
    transcript: state.transcript,
    items: currentItems,
    threadId: ctx.threadId,
  });

  const resolved = unitKeys.map((unitKey) => {
    const mapped = map.get(unitKey);
    const items =
      mapped === undefined
        ? []
        : mapped.itemIds.flatMap((id) => {
            const item = state.allItems.get(id);
            return item !== undefined ? [item] : [];
          });
    return {
      unmapped: mapped === undefined || mapped.itemIds.length === 0,
      hasInherited: items.some((item) => item.threadId !== ctx.threadId),
      own: items.filter((item) => item.threadId === ctx.threadId),
    };
  });
  const unmappedCount = resolved.filter((entry) => entry.unmapped).length;
  const inheritedCount = resolved.filter((entry) => entry.hasInherited).length;
  const ownItems = resolved.flatMap((entry) => entry.own);
  const hidden = ownItems.reduce(
    (acc, item) => setItem(acc, { ...item, forkTranscriptHidden: true, updatedAt: ctx.now }),
    state,
  );
  return {
    ...hidden,
    unmappedUnits: hidden.unmappedUnits + unmappedCount,
    inheritedUnits: hidden.inheritedUnits + inheritedCount,
  };
};

const mirrorMoveUnit = (
  state: MirrorState,
  unitKey: string,
  toIndex: number,
  ctx: MirrorContext,
): MirrorState => {
  const units = buildUnits(state.transcript);
  const currentItems = [...state.allItems.values()];
  const map = mapUnitsToItems({
    transcript: state.transcript,
    items: currentItems,
    threadId: ctx.threadId,
  });
  const mapped = map.get(unitKey);
  if (mapped === undefined || mapped.itemIds.length === 0) {
    return { ...state, unmappedUnits: state.unmappedUnits + 1 };
  }
  const items = mapped.itemIds.flatMap((id) => {
    const item = state.allItems.get(id);
    return item !== undefined ? [item] : [];
  });
  const hasInherited = items.some((item) => item.threadId !== ctx.threadId);
  const own = items
    .filter((item) => item.threadId === ctx.threadId && item.forkTranscriptHidden !== true)
    .toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const withInherited = hasInherited
    ? { ...state, inheritedUnits: state.inheritedUnits + 1 }
    : state;
  if (own.length === 0) return withInherited;

  const rest = units.filter((unit) => unit.key !== unitKey);
  const placement = resolvePlacement(
    rest.slice(0, toIndex),
    rest.slice(toIndex),
    map,
    state.allItems,
    ctx.threadId,
  );

  // Hide originals first, then shift later items in the target run range, then add clones.
  const hidden = own.reduce(
    (acc, item) => setItem(acc, { ...item, forkTranscriptHidden: true, updatedAt: ctx.now }),
    withInherited,
  );
  const shifted = shiftRange(hidden, placement.ordinal, own.length, ctx);
  return own.reduce((acc, item, offset) => {
    const clone: OrchestrationV2TurnItem = {
      ...item,
      id: TurnItemId.make(ctx.newId(item.id)),
      nodeId: null,
      runId: placement.runId,
      ordinal: placement.ordinal + offset,
      updatedAt: ctx.now,
    };
    return setItem(acc, clone, true);
  }, shifted);
};

const mirrorInsertMessage = (state: MirrorState, op: InsertOp, ctx: MirrorContext): MirrorState => {
  const units = buildUnits(state.transcript);
  const currentItems = [...state.allItems.values()];
  const map = mapUnitsToItems({
    transcript: state.transcript,
    items: currentItems,
    threadId: ctx.threadId,
  });
  const placement = resolvePlacement(
    units.slice(0, op.index),
    units.slice(op.index),
    map,
    state.allItems,
    ctx.threadId,
  );
  const shifted = shiftRange(state, placement.ordinal, 1, ctx);
  const at = Option.getOrElse(DateTime.make(op.timestamp), () => ctx.now);
  const messageId = MessageId.make(ctx.newId(op.uuid));
  const turnItemId = TurnItemId.make(ctx.newId(`item:${op.uuid}`));
  const baseItem = {
    id: turnItemId,
    threadId: ctx.threadId,
    runId: placement.runId,
    nodeId: null,
    providerThreadId: ctx.providerThreadId,
    providerTurnId: null,
    nativeItemRef: {
      driver: CLAUDE_DRIVER,
      nativeId: op.uuid,
      strength: "strong" as const,
    },
    parentItemId: null,
    ordinal: placement.ordinal,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };

  const turnItem: OrchestrationV2TurnItem =
    op.role === "user"
      ? {
          ...baseItem,
          type: "user_message",
          createdBy: "user",
          creationSource: "server",
          messageId,
          inputIntent: "turn_start",
          text: op.text,
          attachments: [],
        }
      : {
          ...baseItem,
          type: "assistant_message",
          messageId,
          text: op.text,
          streaming: false,
        };

  const message: OrchestrationV2ConversationMessage = {
    createdBy: op.role === "user" ? "user" : "agent",
    creationSource: "server",
    id: messageId,
    threadId: ctx.threadId,
    runId: placement.runId,
    nodeId: null,
    role: op.role,
    text: op.text,
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
  };

  return setMessage(setItem(shifted, turnItem, true), message);
};

const stepMirror = (state: MirrorState, op: Op, ctx: MirrorContext): MirrorState => {
  const nextTranscript = applyOp(state.transcript, op);
  const mirrored = (() => {
    switch (op.kind) {
      case "editUserText":
        return mirrorEditText(state, nextTranscript, op.uuid, "user_message", ctx);
      case "editAssistantText":
        return mirrorEditText(state, nextTranscript, op.uuid, "assistant_message", ctx);
      case "editSystemContent":
        return mirrorEditSystem(state, op.uuid, op.content, ctx);
      case "removeThinking":
        return mirrorRemoveThinking(state, op.target, ctx);
      case "deleteUnit":
        return mirrorDeleteUnits(state, [op.unit], ctx);
      case "deleteUnits":
        return mirrorDeleteUnits(state, op.units, ctx);
      case "moveUnit":
        return mirrorMoveUnit(state, op.unit, op.toIndex, ctx);
      case "insertMessage":
        return mirrorInsertMessage(state, op, ctx);
    }
  })();
  return { ...mirrored, transcript: nextTranscript };
};

export const planMirror = (input: {
  readonly base: Transcript;
  readonly ops: ReadonlyArray<Op>;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  readonly now: DateTime.Utc;
  readonly newId: (seed: string) => string;
}): MirrorPlan => {
  const originalItemIds = new Set(input.items.map((item) => item.id));
  const ctx: MirrorContext = {
    threadId: input.threadId,
    providerThreadId: input.providerThreadId,
    now: input.now,
    newId: input.newId,
  };
  const initial: MirrorState = {
    transcript: input.base,
    allItems: new Map(input.items.map((item) => [item.id, item] as const)),
    allMessages: new Map(input.messages.map((message) => [message.id, message] as const)),
    dirtyItemIds: new Set<TurnItemId>(),
    dirtyMessageIds: new Set<MessageId>(),
    positionChangedIds: new Set<TurnItemId>(),
    unmappedUnits: 0,
    inheritedUnits: 0,
  };

  const finalState = input.ops.reduce((acc, op) => stepMirror(acc, op, ctx), initial);

  const dirtyItems = [...finalState.dirtyItemIds].flatMap((id) => {
    const item = finalState.allItems.get(id);
    return item !== undefined ? [item] : [];
  });
  const unshiftedExisting = dirtyItems
    .filter((item) => originalItemIds.has(item.id) && !finalState.positionChangedIds.has(item.id))
    .toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  // Emit shifted existing items highest ordinal first before inserts to avoid UNIQUE(thread_id, ordinal) collisions.
  const shiftedExisting = dirtyItems
    .filter((item) => originalItemIds.has(item.id) && finalState.positionChangedIds.has(item.id))
    .toSorted((a, b) => b.ordinal - a.ordinal || a.id.localeCompare(b.id));
  const newlyAdded = dirtyItems
    .filter((item) => !originalItemIds.has(item.id))
    .toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));

  const positions: ReadonlyArray<PositionChange> = [
    ...shiftedExisting.map((item) => ({
      turnItemId: item.id,
      ordinal: item.ordinal,
      insert: false,
    })),
    ...newlyAdded
      .filter((item) => finalState.positionChangedIds.has(item.id))
      .map((item) => ({
        turnItemId: item.id,
        ordinal: item.ordinal,
        insert: true,
      })),
  ];

  const messages = [...finalState.dirtyMessageIds].flatMap((id) => {
    const message = finalState.allMessages.get(id);
    return message !== undefined ? [message] : [];
  });

  return {
    items: [...unshiftedExisting, ...shiftedExisting, ...newlyAdded],
    messages,
    positions,
    unmappedUnits: finalState.unmappedUnits,
    inheritedUnits: finalState.inheritedUnits,
  };
};

export const remapCursor = (input: {
  readonly edited: Transcript;
  readonly base: Transcript;
  readonly cursor: string;
}): string | null => {
  const editedUuids = new Set(
    activePath(input.edited).flatMap((entry) =>
      typeof entry.uuid === "string" ? [entry.uuid] : [],
    ),
  );
  if (editedUuids.has(input.cursor)) return input.cursor;

  const baseMap = byUuid(input.base);
  const walk = (uuid: string | null | undefined, visited: ReadonlySet<string>): string | null => {
    if (uuid === null || uuid === undefined || visited.has(uuid)) return null;
    if (editedUuids.has(uuid)) return uuid;
    const nextVisited = new Set(visited);
    nextVisited.add(uuid);
    return walk(baseMap.get(uuid)?.parentUuid ?? null, nextVisited);
  };

  const start = baseMap.get(input.cursor);
  if (start === undefined) return null;
  return walk(start.parentUuid ?? null, new Set([input.cursor]));
};
