import type { OrchestrationV2TurnItem, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";

import { blocks, buildUnits, byUuid, type Unit } from "./core/model.ts";
import type { Entry, Transcript } from "./core/types.ts";

export interface MappedUnit {
  readonly unitKey: string;
  readonly itemIds: ReadonlyArray<TurnItemId>;
  readonly inherited: boolean;
}

type ClaudeTurnItem = OrchestrationV2TurnItem & {
  readonly nativeItemRef: {
    readonly driver: "claudeAgent";
    readonly nativeId: string;
  };
};

type UserMessageItem = Extract<OrchestrationV2TurnItem, { readonly type: "user_message" }>;

const THINKING_BLOCK_TYPES = new Set(["thinking", "redacted_thinking"]);
const THINKING_SUFFIX = /^:thinking:\d+$/u;

const isClaudeItem = (item: OrchestrationV2TurnItem): item is ClaudeTurnItem =>
  item.nativeItemRef?.driver === "claudeAgent" && item.nativeItemRef.nativeId !== null;

const isUserMessageItem = (item: OrchestrationV2TurnItem): item is UserMessageItem =>
  item.type === "user_message";

const sortItems = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<OrchestrationV2TurnItem> =>
  [...items].toSorted((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));

// Prefer visible items over hidden duplicates left behind by an earlier move.
const preferVisible = <T extends OrchestrationV2TurnItem>(
  candidates: ReadonlyArray<T>,
): ReadonlyArray<T> => {
  const visible = candidates.filter((item) => item.forkTranscriptHidden !== true);
  return visible.length > 0 ? visible : candidates;
};

const uniqueSorted = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<OrchestrationV2TurnItem> => {
  const seen = new Set<TurnItemId>();
  return sortItems(items).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const indexByNativeId = (
  sortedItems: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyMap<string, ReadonlyArray<ClaudeTurnItem>> => {
  const grouped = sortedItems.filter(isClaudeItem).reduce((acc, item) => {
    const id = item.nativeItemRef.nativeId;
    const list = acc.get(id);
    acc.set(id, list === undefined ? [item] : [...list, item]);
    return acc;
  }, new Map<string, ReadonlyArray<ClaudeTurnItem>>());
  return new Map([...grouped.entries()].map(([id, list]) => [id, preferVisible(list)] as const));
};

const entryHasThinking = (entry: Entry | undefined): boolean =>
  entry !== undefined && blocks(entry).some((block) => THINKING_BLOCK_TYPES.has(block.type));

const extractEntryText = (entry: Entry | undefined): string => {
  if (entry === undefined) return "";
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  return blocks(entry)
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string" ? [block.text] : [],
    )
    .join("");
};

const mapAssistantUnit = (
  unit: Unit,
  entryMap: ReadonlyMap<string, Entry>,
  nativeIndex: ReadonlyMap<string, ReadonlyArray<ClaudeTurnItem>>,
): ReadonlyArray<OrchestrationV2TurnItem> => {
  const entries = [...nativeIndex.entries()];
  const matched = unit.main.flatMap((uuid) => {
    const exact = nativeIndex.get(uuid) ?? [];
    const hasThinking = entryHasThinking(entryMap.get(uuid));
    const thinking = entries.flatMap(([nativeId, list]) => {
      if (!nativeId.startsWith(uuid)) return [];
      if (!THINKING_SUFFIX.test(nativeId.slice(uuid.length))) return [];
      return hasThinking || list.some((item) => item.forkTranscriptHidden !== true) ? list : [];
    });
    return [...exact, ...thinking];
  });
  return uniqueSorted(matched);
};

const mapToolUnit = (
  unit: Unit,
  entryMap: ReadonlyMap<string, Entry>,
  nativeIndex: ReadonlyMap<string, ReadonlyArray<ClaudeTurnItem>>,
): ReadonlyArray<OrchestrationV2TurnItem> => {
  const toolIds = unit.main.flatMap((uuid) => {
    const entry = entryMap.get(uuid);
    if (entry === undefined) return [];
    return blocks(entry).flatMap((block) =>
      block.type === "tool_use" && typeof block.id === "string" ? [block.id] : [],
    );
  });
  const entries = [...nativeIndex.entries()];
  const matched = toolIds.flatMap((toolId) => {
    const exact = nativeIndex.get(toolId) ?? [];
    const prefix = `${toolId}:`;
    const prefixed = entries.flatMap(([nativeId, list]) =>
      nativeId.startsWith(prefix) ? list : [],
    );
    return [...exact, ...prefixed];
  });
  return uniqueSorted(matched);
};

const mapSystemUnit = (
  unit: Unit,
  nativeIndex: ReadonlyMap<string, ReadonlyArray<ClaudeTurnItem>>,
): ReadonlyArray<OrchestrationV2TurnItem> =>
  uniqueSorted(unit.main.flatMap((uuid) => nativeIndex.get(uuid) ?? []));

const findRunIdForUserUnit = (
  units: ReadonlyArray<Unit>,
  userIndex: number,
  nonUserMatches: ReadonlyMap<string, ReadonlyArray<OrchestrationV2TurnItem>>,
): RunId | null => {
  const tail = units.slice(userIndex + 1);
  const nextUserOffset = tail.findIndex((unit) => unit.kind === "user");
  const window = nextUserOffset === -1 ? tail : tail.slice(0, nextUserOffset);
  const owner = window
    .filter((unit) => unit.kind === "assistant" || unit.kind === "tool")
    .flatMap((unit) => nonUserMatches.get(unit.key) ?? [])
    .find((item) => item.runId !== null);
  return owner?.runId ?? null;
};

const isSteerIntent = (intent: UserMessageItem["inputIntent"]): boolean =>
  intent === "steer" || intent === "promoted_queued_to_steer";

const isTurnStartIntent = (intent: UserMessageItem["inputIntent"]): boolean =>
  intent === "turn_start" || intent === "queued_turn";

const pickUserItem = (input: {
  readonly unit: Unit;
  readonly unitIndex: number;
  readonly units: ReadonlyArray<Unit>;
  readonly entryMap: ReadonlyMap<string, Entry>;
  readonly nativeIndex: ReadonlyMap<string, ReadonlyArray<ClaudeTurnItem>>;
  readonly userItems: ReadonlyArray<UserMessageItem>;
  readonly nonUserMatches: ReadonlyMap<string, ReadonlyArray<OrchestrationV2TurnItem>>;
  readonly usedUserIds: ReadonlySet<TurnItemId>;
}): UserMessageItem | undefined => {
  const nativeMatch = input.unit.main
    .flatMap((uuid) => input.nativeIndex.get(uuid) ?? [])
    .find(
      (item): item is UserMessageItem & ClaudeTurnItem =>
        isUserMessageItem(item) && !input.usedUserIds.has(item.id),
    );
  if (nativeMatch !== undefined) return nativeMatch;

  const text = input.unit.main.map((uuid) => extractEntryText(input.entryMap.get(uuid))).join("");
  const runId = findRunIdForUserUnit(input.units, input.unitIndex, input.nonUserMatches);
  if (runId !== null) {
    const candidates = preferVisible(
      input.userItems.filter((item) => item.runId === runId && !input.usedUserIds.has(item.id)),
    );
    const steer = candidates.find((item) => isSteerIntent(item.inputIntent) && item.text === text);
    if (steer !== undefined) return steer;
    return candidates.find((item) => isTurnStartIntent(item.inputIntent));
  }

  const runless = preferVisible(
    input.userItems.filter((item) => item.runId === null && !input.usedUserIds.has(item.id)),
  );
  return runless.find((item) => item.text === text);
};

export const mapUnitsToItems = (input: {
  readonly transcript: Transcript;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly threadId: ThreadId;
}): ReadonlyMap<string, MappedUnit> => {
  const units = buildUnits(input.transcript);
  const entryMap = byUuid(input.transcript);
  const sortedItems = sortItems(input.items);
  const nativeIndex = indexByNativeId(sortedItems);
  const userItems = sortedItems.filter(isUserMessageItem);

  const nonUserMatches = new Map<string, ReadonlyArray<OrchestrationV2TurnItem>>(
    units.flatMap((unit) => {
      if (unit.kind === "assistant") {
        return [[unit.key, mapAssistantUnit(unit, entryMap, nativeIndex)] as const];
      }
      if (unit.kind === "tool") {
        return [[unit.key, mapToolUnit(unit, entryMap, nativeIndex)] as const];
      }
      if (unit.kind === "system") {
        return [[unit.key, mapSystemUnit(unit, nativeIndex)] as const];
      }
      return [];
    }),
  );

  const resolved = units.reduce<{
    readonly map: Map<string, MappedUnit>;
    readonly usedUserIds: Set<TurnItemId>;
  }>(
    (acc, unit, unitIndex) => {
      const matchedItems: ReadonlyArray<OrchestrationV2TurnItem> =
        unit.kind === "user"
          ? (() => {
              const picked = pickUserItem({
                unit,
                unitIndex,
                units,
                entryMap,
                nativeIndex,
                userItems,
                nonUserMatches,
                usedUserIds: acc.usedUserIds,
              });
              if (picked !== undefined) acc.usedUserIds.add(picked.id);
              return picked === undefined ? [] : [picked];
            })()
          : (nonUserMatches.get(unit.key) ?? []);

      if (matchedItems.length === 0) return acc;
      acc.map.set(unit.key, {
        unitKey: unit.key,
        itemIds: matchedItems.map((item) => item.id),
        inherited: matchedItems.some((item) => item.threadId !== input.threadId),
      });
      return acc;
    },
    { map: new Map<string, MappedUnit>(), usedUserIds: new Set<TurnItemId>() },
  );

  return resolved.map;
};

export const itemForEntryText = (
  map: ReadonlyMap<string, MappedUnit>,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  uuid: string,
  type: "user_message" | "assistant_message",
): OrchestrationV2TurnItem | undefined => {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const direct = map.get(uuid);
  if (direct !== undefined) {
    const candidates = direct.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item !== undefined && item.type === type ? [item] : [];
    });
    const exact = candidates.find(
      (item) =>
        item.nativeItemRef?.driver === "claudeAgent" && item.nativeItemRef.nativeId === uuid,
    );
    if (exact !== undefined) return exact;
    if (candidates[0] !== undefined) return candidates[0];
  }

  return [...map.values()]
    .flatMap((unit) => unit.itemIds)
    .flatMap((id) => {
      const item = byId.get(id);
      return item !== undefined ? [item] : [];
    })
    .find(
      (item) =>
        item.type === type &&
        item.nativeItemRef?.driver === "claudeAgent" &&
        item.nativeItemRef.nativeId === uuid,
    );
};
