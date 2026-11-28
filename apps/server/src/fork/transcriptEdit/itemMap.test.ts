import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { COMPACTED_FIXTURE_TEXT, FIXTURE_TEXT } from "./core/fixtures.ts";
import { parseJsonl } from "./core/jsonl.ts";
import { itemForEntryText, lastCompactionItemId, mapUnitsToItems } from "./itemMap.ts";

const THREAD_ID = ThreadId.make("thread:main");
const PARENT_THREAD_ID = ThreadId.make("thread:parent");
const PROVIDER_THREAD_ID = ProviderThreadId.make("provider-thread:claude-1");
const RUN_1 = RunId.make("run:1");
const RUN_2 = RunId.make("run:2");
const AT = DateTime.makeUnsafe("2026-11-25T10:00:00.000Z");

type BaseOverrides = {
  readonly id: TurnItemId;
  readonly threadId?: ThreadId;
  readonly runId?: RunId | null;
  readonly nativeId?: string | null;
  readonly driver?: "claudeAgent" | "codex";
  readonly ordinal: number;
  readonly forkTranscriptHidden?: true;
};

const baseFields = (o: BaseOverrides) => ({
  id: o.id,
  threadId: o.threadId ?? THREAD_ID,
  runId: o.runId === undefined ? RUN_1 : o.runId,
  nodeId: null,
  providerThreadId: PROVIDER_THREAD_ID,
  providerTurnId: null,
  nativeItemRef:
    o.nativeId === undefined || o.nativeId === null
      ? null
      : {
          driver: ProviderDriverKind.make(o.driver ?? "claudeAgent"),
          nativeId: o.nativeId,
          strength: "strong" as const,
        },
  parentItemId: null,
  ordinal: o.ordinal,
  status: "completed" as const,
  title: null,
  startedAt: AT,
  completedAt: AT,
  updatedAt: AT,
  ...(o.forkTranscriptHidden === true ? { forkTranscriptHidden: true as const } : {}),
});

const makeUserItem = (
  o: BaseOverrides & {
    readonly messageId: MessageId;
    readonly text: string;
    readonly inputIntent?: "turn_start" | "queued_turn" | "steer" | "promoted_queued_to_steer";
  },
): OrchestrationV2TurnItem => ({
  ...baseFields(o),
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: o.messageId,
  inputIntent: o.inputIntent ?? "turn_start",
  text: o.text,
  attachments: [],
});

const makeAssistantItem = (
  o: BaseOverrides & { readonly messageId: MessageId; readonly text: string },
): OrchestrationV2TurnItem => ({
  ...baseFields(o),
  type: "assistant_message",
  messageId: o.messageId,
  text: o.text,
  streaming: false,
});

const makeReasoningItem = (
  o: BaseOverrides & { readonly text: string },
): OrchestrationV2TurnItem => ({
  ...baseFields(o),
  type: "reasoning",
  text: o.text,
  streaming: false,
});

const makeToolItem = (o: BaseOverrides & { readonly input: string }): OrchestrationV2TurnItem => ({
  ...baseFields(o),
  type: "command_execution",
  input: o.input,
});

const makeSystemItem = (
  o: BaseOverrides & { readonly message: string },
): OrchestrationV2TurnItem => ({
  ...baseFields(o),
  type: "system_notice",
  message: o.message,
});

const fixtureItems = (): ReadonlyArray<OrchestrationV2TurnItem> => [
  makeUserItem({
    id: TurnItemId.make("item:u1"),
    runId: RUN_1,
    ordinal: 1_000_001,
    messageId: MessageId.make("msg:u1"),
    text: "one",
  }),
  makeReasoningItem({
    id: TurnItemId.make("item:a1t"),
    runId: RUN_1,
    nativeId: "a1t:thinking:0",
    ordinal: 1_000_002,
    text: "hm",
  }),
  makeAssistantItem({
    id: TurnItemId.make("item:a1"),
    runId: RUN_1,
    nativeId: "a1",
    ordinal: 1_000_003,
    messageId: MessageId.make("msg:a1"),
    text: "reply one",
  }),
  makeToolItem({
    id: TurnItemId.make("item:tool1"),
    runId: RUN_1,
    nativeId: "toolu_1",
    ordinal: 1_000_004,
    input: "ls",
  }),
  makeAssistantItem({
    id: TurnItemId.make("item:a3"),
    runId: RUN_1,
    nativeId: "a3",
    ordinal: 1_000_005,
    messageId: MessageId.make("msg:a3"),
    text: "done",
  }),
  makeUserItem({
    id: TurnItemId.make("item:u2"),
    runId: RUN_2,
    ordinal: 2_000_001,
    messageId: MessageId.make("msg:u2"),
    text: "two",
  }),
  makeAssistantItem({
    id: TurnItemId.make("item:a4"),
    runId: RUN_2,
    nativeId: "a4",
    ordinal: 2_000_002,
    messageId: MessageId.make("msg:a4"),
    text: "reply two",
  }),
];

const IMPORTED_SESSION = "s-imported";

const entryLine = (
  uuid: string,
  parentUuid: string | null,
  type: "user" | "assistant",
  content: unknown,
  messageId?: string,
) => ({
  type,
  uuid,
  parentUuid,
  sessionId: IMPORTED_SESSION,
  message: { ...(messageId === undefined ? {} : { id: messageId }), role: type, content },
});

const textBlocks = (...texts: ReadonlyArray<string>) =>
  texts.map((text) => ({ type: "text", text }));

const importedTranscript = () =>
  parseJsonl(
    `${[
      entryLine("u1", null, "user", "start"),
      entryLine("a1", "u1", "assistant", textBlocks("Looking."), "m1"),
      entryLine(
        "a1b",
        "a1",
        "assistant",
        [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
        "m1",
      ),
      entryLine("r1", "a1b", "user", [{ type: "tool_result", tool_use_id: "toolu_1" }]),
      entryLine("a2", "r1", "assistant", textBlocks("Done."), "m2"),
      entryLine("u2", "a2", "user", "next"),
      entryLine("a3", "u2", "assistant", textBlocks("Part one"), "m3"),
      entryLine("a3b", "a3", "assistant", textBlocks("\n  Part two  ", "tail"), "m3"),
      entryLine("a4", "a3b", "assistant", textBlocks("Done."), "m4"),
      entryLine("u3", "a4", "user", "live"),
      entryLine("a5", "u3", "assistant", textBlocks("Done."), "m5"),
      { type: "last-prompt", leafUuid: "a5", lastPrompt: "", sessionId: IMPORTED_SESSION },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n")}\n`,
  );

const importedUser = (index: number, text: string) =>
  makeUserItem({
    id: TurnItemId.make(`imp:${index}`),
    runId: null,
    ordinal: index,
    messageId: MessageId.make(`imp-msg:${index}`),
    text,
  });

const importedAssistant = (index: number, text: string) =>
  makeAssistantItem({
    id: TurnItemId.make(`imp:${index}`),
    runId: null,
    ordinal: index,
    messageId: MessageId.make(`imp-msg:${index}`),
    text,
  });

// The importer keeps one item per text record and joins blocks with newlines.
// Each block loses its leading blank lines and trailing space, and keeps its first-line indentation.
const importedItems = (): ReadonlyArray<OrchestrationV2TurnItem> => [
  importedUser(1, "start"),
  importedAssistant(2, "Looking."),
  importedAssistant(3, "Done."),
  importedUser(4, "next"),
  importedAssistant(5, "Part one"),
  importedAssistant(6, "  Part two\ntail"),
  importedAssistant(7, "Done."),
  importedAssistant(8, "Off branch"),
  makeUserItem({
    id: TurnItemId.make("live:u3"),
    ordinal: 1_000_001,
    messageId: MessageId.make("live-msg:u3"),
    text: "live",
  }),
  makeAssistantItem({
    id: TurnItemId.make("live:a5"),
    nativeId: "a5",
    ordinal: 1_000_002,
    messageId: MessageId.make("live-msg:a5"),
    text: "Done.",
  }),
];

describe("itemMap", () => {
  it("links imported assistant items by order and text, each item once", () => {
    const transcript = importedTranscript();
    const items = importedItems();
    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });
    const ids = (key: string) => mapped.get(key)?.itemIds;

    expect(ids("u1")).toEqual([TurnItemId.make("imp:1")]);
    expect(ids("a1")).toEqual([TurnItemId.make("imp:2")]);
    expect(ids("a1b")).toBeUndefined();
    expect(ids("a2")).toEqual([TurnItemId.make("imp:3")]);
    expect(ids("u2")).toEqual([TurnItemId.make("imp:4")]);
    expect(ids("a3")).toEqual([TurnItemId.make("imp:5"), TurnItemId.make("imp:6")]);
    expect(ids("a4")).toEqual([TurnItemId.make("imp:7")]);
    expect(ids("u3")).toEqual([TurnItemId.make("live:u3")]);
    expect(ids("a5")).toEqual([TurnItemId.make("live:a5")]);

    const linked = [...mapped.values()].flatMap((unit) => unit.itemIds);
    expect(new Set(linked).size).toBe(linked.length);
    expect(linked).not.toContain(TurnItemId.make("imp:8"));

    const entryItem = (uuid: string) =>
      itemForEntryText(mapped, items, uuid, "assistant_message", transcript)?.id;
    expect(entryItem("a3")).toBe(TurnItemId.make("imp:5"));
    expect(entryItem("a3b")).toBe(TurnItemId.make("imp:6"));
    expect(entryItem("a2")).toBe(TurnItemId.make("imp:3"));
    expect(entryItem("a4")).toBe(TurnItemId.make("imp:7"));
    expect(entryItem("a5")).toBe(TurnItemId.make("live:a5"));
  });

  it("links an item that an older import trimmed fully", () => {
    const transcript = importedTranscript();
    const items = importedItems().map((item) =>
      item.id === TurnItemId.make("imp:6") ? importedAssistant(6, "Part two\ntail") : item,
    );
    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });
    expect(mapped.get("a3")?.itemIds).toEqual([TurnItemId.make("imp:5"), TurnItemId.make("imp:6")]);
  });

  it("links a repeated imported text by its place between unique texts", () => {
    const transcript = importedTranscript();
    const withoutFirstDone = importedItems().filter((item) => item.id !== TurnItemId.make("imp:3"));
    const withoutSecondDone = importedItems().filter(
      (item) => item.id !== TurnItemId.make("imp:7"),
    );

    const late = mapUnitsToItems({ transcript, items: withoutFirstDone, threadId: THREAD_ID });
    expect(late.get("a2")).toBeUndefined();
    expect(late.get("a4")?.itemIds).toEqual([TurnItemId.make("imp:7")]);

    const early = mapUnitsToItems({ transcript, items: withoutSecondDone, threadId: THREAD_ID });
    expect(early.get("a2")?.itemIds).toEqual([TurnItemId.make("imp:3")]);
    expect(early.get("a4")).toBeUndefined();
  });

  it("does not link run or native items by text, and follows a moved imported clone", () => {
    const transcript = importedTranscript();
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      ...importedItems().flatMap((item) =>
        item.id === TurnItemId.make("imp:2")
          ? [{ ...item, forkTranscriptHidden: true as const }]
          : item.id === TurnItemId.make("imp:7")
            ? [{ ...item, runId: RUN_1 }]
            : [item],
      ),
      importedAssistant(9, "Looking."),
      makeAssistantItem({
        id: TurnItemId.make("live:other"),
        nativeId: "other",
        ordinal: 1_000_003,
        messageId: MessageId.make("live-msg:other"),
        text: "Done.",
      }),
    ];
    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });

    expect(mapped.get("a1")).toBeUndefined();
    expect(mapped.get("a4")).toBeUndefined();
    expect(mapped.get("a2")?.itemIds).toEqual([TurnItemId.make("imp:3")]);

    const reordered = parseJsonl(
      `${[
        entryLine("u1", null, "user", "start"),
        entryLine("a3", "u1", "assistant", textBlocks("Part one"), "m3"),
        entryLine("a1", "a3", "assistant", textBlocks("Looking."), "m1"),
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`,
    );
    const moved = mapUnitsToItems({
      transcript: reordered,
      items: [
        importedUser(1, "start"),
        { ...importedAssistant(2, "Looking."), forkTranscriptHidden: true as const },
        importedAssistant(3, "Part one"),
        importedAssistant(4, "Looking."),
      ],
      threadId: THREAD_ID,
    });
    expect(moved.get("a3")?.itemIds).toEqual([TurnItemId.make("imp:3")]);
    expect(moved.get("a1")?.itemIds).toEqual([TurnItemId.make("imp:4")]);
  });

  it("maps user, assistant, thinking, and tool units to their T3 items", () => {
    const transcript = parseJsonl(FIXTURE_TEXT);
    const items = fixtureItems();
    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });

    expect(mapped.get("u1")).toEqual({
      unitKey: "u1",
      itemIds: [TurnItemId.make("item:u1")],
      inherited: false,
    });
    expect(mapped.get("a1")).toEqual({
      unitKey: "a1",
      itemIds: [TurnItemId.make("item:a1t"), TurnItemId.make("item:a1")],
      inherited: false,
    });
    expect(mapped.get("a2")).toEqual({
      unitKey: "a2",
      itemIds: [TurnItemId.make("item:tool1")],
      inherited: false,
    });
    expect(mapped.get("a3")).toEqual({
      unitKey: "a3",
      itemIds: [TurnItemId.make("item:a3")],
      inherited: false,
    });
    expect(mapped.get("u2")).toEqual({
      unitKey: "u2",
      itemIds: [TurnItemId.make("item:u2")],
      inherited: false,
    });
    expect(mapped.get("a4")).toEqual({
      unitKey: "a4",
      itemIds: [TurnItemId.make("item:a4")],
      inherited: false,
    });

    expect(itemForEntryText(mapped, items, "u1", "user_message", transcript)?.id).toBe(
      TurnItemId.make("item:u1"),
    );
    expect(itemForEntryText(mapped, items, "a1", "assistant_message", transcript)?.id).toBe(
      TurnItemId.make("item:a1"),
    );
    expect(
      itemForEntryText(mapped, items, "missing", "assistant_message", transcript),
    ).toBeUndefined();
  });

  it("marks a unit inherited when a mapped item belongs to another thread", () => {
    const transcript = parseJsonl(FIXTURE_TEXT);
    const items = fixtureItems().map((item) =>
      item.id === TurnItemId.make("item:a1") ? { ...item, threadId: PARENT_THREAD_ID } : item,
    );
    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });

    expect(mapped.get("a1")?.inherited).toBe(true);
    expect(mapped.get("u1")?.inherited).toBe(false);
    expect(mapped.get("a2")?.inherited).toBe(false);
  });

  it("maps steer user units, run-less user units, prefixed tool items, and system items", () => {
    const lines = [
      {
        type: "user",
        uuid: "u-imported",
        parentUuid: null,
        sessionId: "s-1",
        message: { role: "user", content: "imported" },
      },
      {
        type: "user",
        uuid: "u-start",
        parentUuid: "u-imported",
        sessionId: "s-1",
        message: { role: "user", content: "start" },
      },
      {
        type: "assistant",
        uuid: "a-tool",
        parentUuid: "u-start",
        sessionId: "s-1",
        message: {
          id: "m1",
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "pwd" } }],
        },
      },
      {
        type: "user",
        uuid: "r-tool",
        parentUuid: "a-tool",
        sessionId: "s-1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "/work" }],
        },
      },
      {
        type: "user",
        uuid: "u-steer",
        parentUuid: "r-tool",
        sessionId: "s-1",
        message: { role: "user", content: "change course" },
      },
      {
        type: "assistant",
        uuid: "a-end",
        parentUuid: "u-steer",
        sessionId: "s-1",
        message: { id: "m2", role: "assistant", content: [{ type: "text", text: "ok" }] },
      },
      {
        type: "system",
        uuid: "sys-1",
        parentUuid: "a-end",
        sessionId: "s-1",
        content: "notice text",
      },
      { type: "last-prompt", leafUuid: "sys-1", lastPrompt: "", sessionId: "s-1" },
    ];
    const transcript = parseJsonl(`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      makeUserItem({
        id: TurnItemId.make("item:imported"),
        runId: null,
        ordinal: 1,
        messageId: MessageId.make("msg:imported"),
        text: "imported",
      }),
      makeUserItem({
        id: TurnItemId.make("item:start"),
        runId: RUN_1,
        ordinal: 1_000_001,
        messageId: MessageId.make("msg:start"),
        text: "start",
        inputIntent: "queued_turn",
      }),
      makeToolItem({
        id: TurnItemId.make("item:tool-sub"),
        runId: RUN_1,
        nativeId: "toolu_9:sub",
        ordinal: 1_000_002,
        input: "pwd",
      }),
      makeUserItem({
        id: TurnItemId.make("item:steer"),
        runId: RUN_1,
        ordinal: 1_000_003,
        messageId: MessageId.make("msg:steer"),
        text: "change course",
        inputIntent: "steer",
      }),
      makeAssistantItem({
        id: TurnItemId.make("item:end"),
        runId: RUN_1,
        nativeId: "a-end",
        ordinal: 1_000_004,
        messageId: MessageId.make("msg:end"),
        text: "ok",
      }),
      makeAssistantItem({
        id: TurnItemId.make("item:codex"),
        runId: RUN_1,
        nativeId: "a-end",
        driver: "codex",
        ordinal: 1_000_005,
        messageId: MessageId.make("msg:codex"),
        text: "ignored codex",
      }),
      makeSystemItem({
        id: TurnItemId.make("item:sys"),
        runId: RUN_1,
        nativeId: "sys-1",
        ordinal: 1_000_006,
        message: "notice text",
      }),
    ];

    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });
    expect(mapped.get("u-imported")?.itemIds).toEqual([TurnItemId.make("item:imported")]);
    expect(mapped.get("u-start")?.itemIds).toEqual([TurnItemId.make("item:start")]);
    expect(mapped.get("a-tool")?.itemIds).toEqual([TurnItemId.make("item:tool-sub")]);
    expect(mapped.get("u-steer")?.itemIds).toEqual([TurnItemId.make("item:steer")]);
    expect(mapped.get("a-end")?.itemIds).toEqual([TurnItemId.make("item:end")]);
    expect(mapped.get("sys-1")?.itemIds).toEqual([TurnItemId.make("item:sys")]);
  });

  it("prefers visible items over hidden duplicates when mapping a moved unit", () => {
    const transcript = parseJsonl(FIXTURE_TEXT);
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      ...fixtureItems().map((item) =>
        item.id === TurnItemId.make("item:a4")
          ? { ...item, forkTranscriptHidden: true as const }
          : item,
      ),
      makeAssistantItem({
        id: TurnItemId.make("item:a4-clone"),
        runId: RUN_1,
        nativeId: "a4",
        ordinal: 1_000_006,
        messageId: MessageId.make("msg:a4"),
        text: "reply two",
      }),
    ];

    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });
    expect(mapped.get("a4")?.itemIds).toEqual([TurnItemId.make("item:a4-clone")]);
  });

  it("maps streamed assistant items by message id and finds the item of each text entry", () => {
    const transcript = parseJsonl(COMPACTED_FIXTURE_TEXT);
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      makeReasoningItem({
        id: TurnItemId.make("item:a5t"),
        nativeId: "msg_5:thinking:0",
        ordinal: 3_000_002,
        text: "plan",
      }),
      makeAssistantItem({
        id: TurnItemId.make("item:a5"),
        nativeId: "msg_5:text:0",
        ordinal: 3_000_003,
        messageId: MessageId.make("msg:a5"),
        text: "reply three",
      }),
      makeAssistantItem({
        id: TurnItemId.make("item:a5b"),
        nativeId: "msg_5:text:1",
        ordinal: 3_000_004,
        messageId: MessageId.make("msg:a5b"),
        text: "more three",
      }),
    ];

    const mapped = mapUnitsToItems({ transcript, items, threadId: THREAD_ID });
    expect(mapped.get("a5")?.itemIds).toEqual([
      TurnItemId.make("item:a5t"),
      TurnItemId.make("item:a5"),
      TurnItemId.make("item:a5b"),
    ]);
    expect(itemForEntryText(mapped, items, "a5", "assistant_message", transcript)?.id).toBe(
      TurnItemId.make("item:a5"),
    );
    expect(itemForEntryText(mapped, items, "a5b", "assistant_message", transcript)?.id).toBe(
      TurnItemId.make("item:a5b"),
    );
  });

  it("gives the last completed Claude compaction item when the active path starts at a boundary", () => {
    const compaction = (id: string, ordinal: number, status: "completed" | "failed") =>
      ({
        ...baseFields({ id: TurnItemId.make(id), nativeId: `native:${id}`, ordinal }),
        status,
        type: "compaction",
        driver: ProviderDriverKind.make("claudeAgent"),
      }) satisfies OrchestrationV2TurnItem;
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      compaction("item:c1", 1_000_009, "completed"),
      compaction("item:c2", 2_000_009, "completed"),
      compaction("item:c3", 3_000_009, "failed"),
      { ...compaction("item:c4", 4_000_009, "completed"), forkTranscriptHidden: true },
    ];

    expect(lastCompactionItemId(parseJsonl(COMPACTED_FIXTURE_TEXT), items)).toBe("item:c2");
    expect(lastCompactionItemId(parseJsonl(FIXTURE_TEXT), items)).toBeNull();
  });
});
