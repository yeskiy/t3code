import { assert, describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as TurnItemPositionStore from "../../orchestration-v2/TurnItemPositionStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { FIXTURE_TEXT } from "./core/fixtures.ts";
import { parseJsonl } from "./core/jsonl.ts";
import { applyOp, applyOps } from "./core/ops.ts";
import { planMirror, remapCursor, remirror } from "./projectionMirror.ts";

const THREAD_ID = ThreadId.make("thread:main");
const PARENT_THREAD_ID = ThreadId.make("thread:parent");
const PROVIDER_THREAD_ID = ProviderThreadId.make("provider-thread:claude-1");
const RUN_1 = RunId.make("run:1");
const RUN_2 = RunId.make("run:2");
const AT = DateTime.makeUnsafe("2026-11-25T10:00:00.000Z");
const NOW = DateTime.makeUnsafe("2026-11-25T11:00:00.000Z");

const makeNewId = (seed: string) => `new:${seed}`;

type BaseOverrides = {
  readonly id: TurnItemId;
  readonly threadId?: ThreadId;
  readonly runId?: RunId | null;
  readonly nativeId?: string | null;
  readonly ordinal: number;
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
          driver: ProviderDriverKind.make("claudeAgent"),
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
});

const makeMessage = (input: {
  readonly id: MessageId;
  readonly threadId?: ThreadId;
  readonly runId: RunId | null;
  readonly role: "user" | "assistant";
  readonly text: string;
}): OrchestrationV2ConversationMessage => ({
  createdBy: input.role === "user" ? "user" : "agent",
  creationSource: input.role === "user" ? "web" : "provider",
  id: input.id,
  threadId: input.threadId ?? THREAD_ID,
  runId: input.runId,
  nodeId: null,
  role: input.role,
  text: input.text,
  attachments: [],
  streaming: false,
  createdAt: AT,
  updatedAt: AT,
});

const fixtureState = () => {
  const messages: ReadonlyArray<OrchestrationV2ConversationMessage> = [
    makeMessage({ id: MessageId.make("msg:u1"), runId: RUN_1, role: "user", text: "one" }),
    makeMessage({
      id: MessageId.make("msg:a1"),
      runId: RUN_1,
      role: "assistant",
      text: "reply one",
    }),
    makeMessage({ id: MessageId.make("msg:a3"), runId: RUN_1, role: "assistant", text: "done" }),
    makeMessage({ id: MessageId.make("msg:u2"), runId: RUN_2, role: "user", text: "two" }),
    makeMessage({
      id: MessageId.make("msg:a4"),
      runId: RUN_2,
      role: "assistant",
      text: "reply two",
    }),
  ];

  const items: ReadonlyArray<OrchestrationV2TurnItem> = [
    {
      ...baseFields({ id: TurnItemId.make("item:u1"), runId: RUN_1, ordinal: 1_000_001 }),
      type: "user_message",
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make("msg:u1"),
      inputIntent: "turn_start",
      text: "one",
      attachments: [],
    },
    {
      ...baseFields({
        id: TurnItemId.make("item:a1t"),
        runId: RUN_1,
        nativeId: "a1t:thinking:0",
        ordinal: 1_000_002,
      }),
      type: "reasoning",
      text: "hm",
      streaming: false,
    },
    {
      ...baseFields({
        id: TurnItemId.make("item:a1"),
        runId: RUN_1,
        nativeId: "a1",
        ordinal: 1_000_003,
      }),
      type: "assistant_message",
      messageId: MessageId.make("msg:a1"),
      text: "reply one",
      streaming: false,
    },
    {
      ...baseFields({
        id: TurnItemId.make("item:tool1"),
        runId: RUN_1,
        nativeId: "toolu_1",
        ordinal: 1_000_004,
      }),
      type: "command_execution",
      input: "ls",
    },
    {
      ...baseFields({
        id: TurnItemId.make("item:a3"),
        runId: RUN_1,
        nativeId: "a3",
        ordinal: 1_000_005,
      }),
      type: "assistant_message",
      messageId: MessageId.make("msg:a3"),
      text: "done",
      streaming: false,
    },
    {
      ...baseFields({ id: TurnItemId.make("item:u2"), runId: RUN_2, ordinal: 2_000_001 }),
      type: "user_message",
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make("msg:u2"),
      inputIntent: "turn_start",
      text: "two",
      attachments: [],
    },
    {
      ...baseFields({
        id: TurnItemId.make("item:a4"),
        runId: RUN_2,
        nativeId: "a4",
        ordinal: 2_000_002,
      }),
      type: "assistant_message",
      messageId: MessageId.make("msg:a4"),
      text: "reply two",
      streaming: false,
    },
  ];

  return { base: parseJsonl(FIXTURE_TEXT), items, messages };
};

// Imported history: run-less items without native ids, and texts that repeat.
const importedState = () => {
  const line = (uuid: string, parentUuid: string | null, type: string, content: unknown) => ({
    type,
    uuid,
    parentUuid,
    sessionId: "s-imported",
    message: { id: `m:${uuid}`, role: type, content },
  });
  const text = (value: string) => [{ type: "text", text: value }];
  const base = parseJsonl(
    `${[
      line("u1", null, "user", "start"),
      line("a1", "u1", "assistant", text("Looking.")),
      line("a2", "a1", "assistant", text("Done.")),
      line("u2", "a2", "user", "next"),
      line("a3", "u2", "assistant", text("Part one")),
      line("a4", "a3", "assistant", text("Done.")),
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")}\n`,
  );
  const rows = [
    ["user", "start"],
    ["assistant", "Looking."],
    ["assistant", "Done."],
    ["user", "next"],
    ["assistant", "Part one"],
    ["assistant", "Done."],
  ] as const;
  const messages = rows.map(([role, value], index) =>
    makeMessage({ id: MessageId.make(`imp-msg:${index + 1}`), runId: null, role, text: value }),
  );
  const items: ReadonlyArray<OrchestrationV2TurnItem> = rows.map(([role, value], index) => {
    const common = {
      ...baseFields({ id: TurnItemId.make(`imp:${index + 1}`), runId: null, ordinal: index + 1 }),
      messageId: MessageId.make(`imp-msg:${index + 1}`),
      text: value,
    };
    return role === "user"
      ? {
          ...common,
          type: "user_message",
          createdBy: "user",
          creationSource: "server",
          inputIntent: "turn_start",
          attachments: [],
        }
      : { ...common, type: "assistant_message", streaming: false };
  });
  return { base, items, messages };
};

const positionLayer = TurnItemPositionStore.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

describe("projectionMirror", () => {
  it("updates item and message text on editAssistantText and editUserText", () => {
    const { base, items, messages } = fixtureState();
    const plan = planMirror({
      base,
      ops: [
        { kind: "editAssistantText", uuid: "a1", block: 0, text: "UPDATED REPLY" },
        { kind: "editUserText", uuid: "u1", block: null, text: "UPDATED ONE" },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(plan.positions).toEqual([]);
    expect(plan.unmappedUnits).toBe(0);
    expect(plan.inheritedUnits).toBe(0);
    expect(plan.items).toHaveLength(2);
    expect(plan.messages).toHaveLength(2);

    const a1Item = plan.items.find((i) => i.id === TurnItemId.make("item:a1"));
    const u1Item = plan.items.find((i) => i.id === TurnItemId.make("item:u1"));
    expect(a1Item).toMatchObject({
      type: "assistant_message",
      text: "UPDATED REPLY",
      updatedAt: NOW,
    });
    expect(u1Item).toMatchObject({ type: "user_message", text: "UPDATED ONE", updatedAt: NOW });

    const a1Msg = plan.messages.find((m) => m.id === MessageId.make("msg:a1"));
    const u1Msg = plan.messages.find((m) => m.id === MessageId.make("msg:u1"));
    expect(a1Msg).toMatchObject({ text: "UPDATED REPLY", updatedAt: NOW });
    expect(u1Msg).toMatchObject({ text: "UPDATED ONE", updatedAt: NOW });
  });

  it("edits and deletes the imported item of the same entry when a text repeats", () => {
    const { base, items, messages } = importedState();
    const plan = planMirror({
      base,
      ops: [
        { kind: "editAssistantText", uuid: "a4", block: 0, text: "Finished." },
        { kind: "deleteUnit", unit: "a2" },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(plan.unmappedUnits).toBe(0);
    expect(plan.positions).toEqual([]);
    expect(
      plan.items.map((i) => [i.id, "text" in i ? i.text : null, i.forkTranscriptHidden]),
    ).toEqual([
      [TurnItemId.make("imp:3"), "Done.", true],
      [TurnItemId.make("imp:6"), "Finished.", undefined],
    ]);
    expect(plan.messages.map((m) => [m.id, m.text])).toEqual([
      [MessageId.make("imp-msg:6"), "Finished."],
    ]);
  });

  it("moves an imported item with a run-less clone and edits the clone", () => {
    const { base, items, messages } = importedState();
    const plan = planMirror({
      base,
      ops: [
        { kind: "moveUnit", unit: "a4", toIndex: 1 },
        { kind: "editAssistantText", uuid: "a4", block: 0, text: "Finished." },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(plan.unmappedUnits).toBe(0);
    const byId = new Map(plan.items.map((i) => [i.id, i] as const));
    expect(byId.get(TurnItemId.make("imp:6"))?.forkTranscriptHidden).toBe(true);
    expect(byId.get(TurnItemId.make("new:imp:6"))).toMatchObject({
      runId: null,
      nativeItemRef: null,
      ordinal: 2,
      text: "Finished.",
    });
    expect(byId.get(TurnItemId.make("imp:3"))).toMatchObject({ ordinal: 4, text: "Done." });
    expect(byId.get(TurnItemId.make("imp:3"))?.forkTranscriptHidden).toBeUndefined();
    expect(plan.messages.map((m) => [m.id, m.text])).toEqual([
      [MessageId.make("imp-msg:6"), "Finished."],
    ]);
  });

  it("hides only the tool item on deleteUnit a2", () => {
    const { base, items, messages } = fixtureState();
    const plan = planMirror({
      base,
      ops: [{ kind: "deleteUnit", unit: "a2" }],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(plan.items.map((i) => [i.id, i.forkTranscriptHidden])).toEqual([
      [TurnItemId.make("item:tool1"), true],
    ]);
    expect(plan.messages).toEqual([]);
    expect(plan.positions).toEqual([]);
  });

  it("hides only the reasoning item on removeThinking all and single target", () => {
    const { base, items, messages } = fixtureState();
    const allPlan = planMirror({
      base,
      ops: [{ kind: "removeThinking", target: "all" }],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(allPlan.items.map((i) => [i.id, i.forkTranscriptHidden])).toEqual([
      [TurnItemId.make("item:a1t"), true],
    ]);
    expect(allPlan.messages).toEqual([]);

    const onePlan = planMirror({
      base,
      ops: [{ kind: "removeThinking", target: { uuid: "a1t", block: 0 } }],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });
    expect(onePlan.items.map((i) => [i.id, i.forkTranscriptHidden])).toEqual([
      [TurnItemId.make("item:a1t"), true],
    ]);
  });

  it("inserts a user item at index 4 right after a3 without shifting run 1 items", () => {
    const { base, items, messages } = fixtureState();
    const insertAt = "2026-11-25T10:00:06.500Z";
    const plan = planMirror({
      base,
      ops: [
        {
          kind: "insertMessage",
          role: "user",
          text: "inserted prompt",
          index: 4,
          uuid: "n1",
          timestamp: insertAt,
          messageId: null,
        },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(plan.items).toHaveLength(1);
    const inserted = plan.items[0]!;
    expect(inserted).toMatchObject({
      type: "user_message",
      createdBy: "user",
      creationSource: "server",
      inputIntent: "turn_start",
      attachments: [],
      text: "inserted prompt",
      messageId: MessageId.make("new:n1"),
      runId: RUN_1,
      nodeId: null,
      providerThreadId: PROVIDER_THREAD_ID,
      nativeItemRef: { driver: "claudeAgent", nativeId: "n1", strength: "strong" },
      ordinal: 1_000_006,
      status: "completed",
      startedAt: DateTime.makeUnsafe(insertAt),
      completedAt: DateTime.makeUnsafe(insertAt),
      updatedAt: DateTime.makeUnsafe(insertAt),
    });
    expect(plan.messages).toEqual([
      {
        createdBy: "user",
        creationSource: "server",
        id: MessageId.make("new:n1"),
        threadId: THREAD_ID,
        runId: RUN_1,
        nodeId: null,
        role: "user",
        text: "inserted prompt",
        attachments: [],
        streaming: false,
        createdAt: DateTime.makeUnsafe(insertAt),
        updatedAt: DateTime.makeUnsafe(insertAt),
      },
    ]);
    expect(plan.positions).toEqual([{ turnItemId: inserted.id, ordinal: 1_000_006, insert: true }]);
  });

  it("hides a4, adds a clone in run 1 after u1, and shifts four later run 1 items on moveUnit", () => {
    const { base, items, messages } = fixtureState();
    const plan = planMirror({
      base,
      ops: [{ kind: "moveUnit", unit: "a4", toIndex: 1 }],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    const hiddenA4 = plan.items.find((i) => i.id === TurnItemId.make("item:a4"));
    const cloneA4 = plan.items.find((i) => i.id === TurnItemId.make("new:item:a4"));
    expect(hiddenA4?.forkTranscriptHidden).toBe(true);
    expect(cloneA4).toMatchObject({
      id: TurnItemId.make("new:item:a4"),
      type: "assistant_message",
      text: "reply two",
      runId: RUN_1,
      nodeId: null,
      ordinal: 1_000_002,
      nativeItemRef: { driver: "claudeAgent", nativeId: "a4", strength: "strong" },
    });
    expect(cloneA4?.forkTranscriptHidden).toBeUndefined();

    const shiftedById = new Map(
      plan.items
        .filter(
          (i) => i.id !== TurnItemId.make("item:a4") && i.id !== TurnItemId.make("new:item:a4"),
        )
        .map((i) => [i.id, i.ordinal] as const),
    );
    expect(shiftedById).toEqual(
      new Map([
        [TurnItemId.make("item:a1t"), 1_000_003],
        [TurnItemId.make("item:a1"), 1_000_004],
        [TurnItemId.make("item:tool1"), 1_000_005],
        [TurnItemId.make("item:a3"), 1_000_006],
      ]),
    );

    // Shifts emit highest ordinal first before inserts to satisfy UNIQUE(thread_id, ordinal).
    expect(plan.positions).toEqual([
      { turnItemId: TurnItemId.make("item:a3"), ordinal: 1_000_006, insert: false },
      { turnItemId: TurnItemId.make("item:tool1"), ordinal: 1_000_005, insert: false },
      { turnItemId: TurnItemId.make("item:a1"), ordinal: 1_000_004, insert: false },
      { turnItemId: TurnItemId.make("item:a1t"), ordinal: 1_000_003, insert: false },
      { turnItemId: TurnItemId.make("new:item:a4"), ordinal: 1_000_002, insert: true },
    ]);
  });

  it("handles deleteUnits, insertMessage at index 0, and chained moveUnit plus editAssistantText", () => {
    const { base, items, messages } = fixtureState();
    const deletePlan = planMirror({
      base,
      ops: [{ kind: "deleteUnits", units: ["a2", "a3"] }],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });
    expect(deletePlan.items.map((i) => [i.id, i.forkTranscriptHidden])).toEqual([
      [TurnItemId.make("item:tool1"), true],
      [TurnItemId.make("item:a3"), true],
    ]);

    const prependPlan = planMirror({
      base,
      ops: [
        {
          kind: "insertMessage",
          role: "assistant",
          text: "before first",
          index: 0,
          uuid: "n0",
          timestamp: "2026-11-25T09:59:59.000Z",
          messageId: null,
        },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });
    expect(prependPlan.positions).toEqual([
      { turnItemId: TurnItemId.make("item:a3"), ordinal: 1_000_006, insert: false },
      { turnItemId: TurnItemId.make("item:tool1"), ordinal: 1_000_005, insert: false },
      { turnItemId: TurnItemId.make("item:a1"), ordinal: 1_000_004, insert: false },
      { turnItemId: TurnItemId.make("item:a1t"), ordinal: 1_000_003, insert: false },
      { turnItemId: TurnItemId.make("item:u1"), ordinal: 1_000_002, insert: false },
      { turnItemId: TurnItemId.make("new:item:n0"), ordinal: 1_000_001, insert: true },
    ]);

    const chainedPlan = planMirror({
      base,
      ops: [
        { kind: "moveUnit", unit: "a3", toIndex: 1 },
        { kind: "editAssistantText", uuid: "a3", block: 0, text: "MOVED DONE" },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });
    const cloneA3 = chainedPlan.items.find((i) => i.id === TurnItemId.make("new:item:a3"));
    const oldA3 = chainedPlan.items.find((i) => i.id === TurnItemId.make("item:a3"));
    expect(cloneA3).toMatchObject({
      type: "assistant_message",
      text: "MOVED DONE",
      ordinal: 1_000_002,
    });
    expect(oldA3).toMatchObject({ forkTranscriptHidden: true, ordinal: 1_000_006 });
    expect(chainedPlan.messages).toEqual([
      expect.objectContaining({ id: MessageId.make("msg:a3"), text: "MOVED DONE" }),
    ]);
  });

  it("skips inherited items, counts unmapped units, and updates system_notice message", () => {
    const lines = [
      {
        type: "system",
        uuid: "sys-1",
        parentUuid: null,
        sessionId: "s-1",
        content: "old notice",
      },
      {
        type: "system",
        uuid: "sys-unmapped",
        parentUuid: "sys-1",
        sessionId: "s-1",
        content: "file only",
      },
      {
        type: "assistant",
        uuid: "a-inherited",
        parentUuid: "sys-unmapped",
        sessionId: "s-1",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "from parent" }] },
      },
      { type: "last-prompt", leafUuid: "a-inherited", lastPrompt: "", sessionId: "s-1" },
    ];
    const base = parseJsonl(`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      {
        ...baseFields({
          id: TurnItemId.make("item:sys-1"),
          runId: RUN_1,
          nativeId: "sys-1",
          ordinal: 1_000_001,
        }),
        type: "system_notice",
        message: "old notice",
      },
      {
        ...baseFields({
          id: TurnItemId.make("item:parent-a"),
          threadId: PARENT_THREAD_ID,
          runId: RUN_1,
          nativeId: "a-inherited",
          ordinal: 1_000_002,
        }),
        type: "assistant_message",
        messageId: MessageId.make("msg:parent-a"),
        text: "from parent",
        streaming: false,
      },
    ];
    const messages = [
      makeMessage({
        id: MessageId.make("msg:parent-a"),
        threadId: PARENT_THREAD_ID,
        runId: RUN_1,
        role: "assistant",
        text: "from parent",
      }),
    ];

    const plan = planMirror({
      base,
      ops: [
        { kind: "editSystemContent", uuid: "sys-1", content: "new notice" },
        { kind: "editSystemContent", uuid: "sys-unmapped", content: "changed file only" },
        { kind: "editAssistantText", uuid: "a-inherited", block: 0, text: "edited parent" },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });

    expect(plan.unmappedUnits).toBe(1);
    expect(plan.inheritedUnits).toBe(1);
    expect(plan.messages).toEqual([]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      id: TurnItemId.make("item:sys-1"),
      type: "system_notice",
      message: "new notice",
      updatedAt: NOW,
    });
  });

  it("remirror restores text, unhides restored units, and hides items that inserts and moves added", () => {
    const { base, items, messages } = fixtureState();
    const plan = planMirror({
      base,
      ops: [
        { kind: "editAssistantText", uuid: "a1", block: 0, text: "EDITED" },
        { kind: "editUserText", uuid: "u1", block: null, text: "EDITED ONE" },
        { kind: "deleteUnit", unit: "a3" },
        { kind: "removeThinking", target: "all" },
        { kind: "moveUnit", unit: "a4", toIndex: 1 },
        {
          kind: "insertMessage",
          role: "user",
          text: "inserted",
          index: 2,
          uuid: "n1",
          timestamp: "2026-11-25T10:00:02.500Z",
          messageId: null,
        },
      ],
      items,
      messages,
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      now: NOW,
      newId: makeNewId,
    });
    const upsert = <T extends { readonly id: string }>(
      current: ReadonlyArray<T>,
      next: ReadonlyArray<T>,
    ): ReadonlyArray<T> => [
      ...new Map([...current, ...next].map((value) => [value.id, value] as const)).values(),
    ];
    const editedItems = upsert(items, plan.items);
    const editedMessages = upsert(messages, plan.messages);

    const restored = remirror({
      transcript: base,
      items: editedItems,
      messages: editedMessages,
      threadId: THREAD_ID,
      now: NOW,
    });
    const after = new Map(upsert(editedItems, restored.items).map((i) => [i.id, i] as const));
    const view = (id: string) => {
      const item = after.get(TurnItemId.make(id));
      return [
        item?.forkTranscriptHidden === true,
        item !== undefined && "text" in item ? item.text : null,
      ];
    };

    expect(restored.positions).toEqual([]);
    expect(restored.unmappedUnits).toBe(0);
    expect(restored.inheritedUnits).toBe(0);
    expect(view("item:u1")).toEqual([false, "one"]);
    expect(view("item:a1t")).toEqual([false, "hm"]);
    expect(view("item:a1")).toEqual([false, "reply one"]);
    expect(view("item:a3")).toEqual([false, "done"]);
    expect(view("item:a4")).toEqual([false, "reply two"]);
    expect(view("new:item:a4")).toEqual([true, "reply two"]);
    expect(view("new:item:n1")).toEqual([true, "inserted"]);
    const restoredMessages = new Map(
      upsert(editedMessages, restored.messages).map((m) => [m.id, m.text] as const),
    );
    expect(restoredMessages.get(MessageId.make("msg:a1"))).toBe("reply one");
    expect(restoredMessages.get(MessageId.make("msg:u1"))).toBe("one");

    const again = remirror({
      transcript: base,
      items: [...after.values()],
      messages: upsert(editedMessages, restored.messages),
      threadId: THREAD_ID,
      now: NOW,
    });
    expect(again.items).toEqual([]);
    expect(again.messages).toEqual([]);
  });

  it("remirror hides a reasoning item when the restored entry has no thinking", () => {
    const { base, items, messages } = fixtureState();
    const withoutThinking = applyOp(base, { kind: "removeThinking", target: "all" });
    const restored = remirror({
      transcript: withoutThinking,
      items,
      messages,
      threadId: THREAD_ID,
      now: NOW,
    });
    expect(restored.items.map((i) => [i.id, i.forkTranscriptHidden])).toEqual([
      [TurnItemId.make("item:a1t"), true],
    ]);
  });

  it("remaps deleted cursors to their nearest surviving ancestor on the edited path", () => {
    const base = parseJsonl(FIXTURE_TEXT);
    const withoutA3 = applyOp(base, { kind: "deleteUnit", unit: "a3" });
    expect(remapCursor({ edited: withoutA3, base, cursor: "a3" })).toBe("r1");
    expect(remapCursor({ edited: withoutA3, base, cursor: "a4" })).toBe("a4");

    const withoutA2A3 = applyOps(base, [
      { kind: "deleteUnit", unit: "a3" },
      { kind: "deleteUnit", unit: "a2" },
    ]);
    expect(remapCursor({ edited: withoutA2A3, base, cursor: "a3" })).toBe("a1");

    const withoutAllBeforeU2 = applyOp(base, {
      kind: "deleteUnits",
      units: ["u1", "a1", "a2", "a3"],
    });
    expect(remapCursor({ edited: withoutAllBeforeU2, base, cursor: "a3" })).toBeNull();
    expect(remapCursor({ edited: withoutA3, base, cursor: "unknown-uuid" })).toBeNull();
  });

  it.effect(
    "applies shifted and inserted positions to orchestration_v2_turn_item_positions without UNIQUE collisions",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const positionStore = yield* TurnItemPositionStore.TurnItemPositionStoreV2;
        const { base, items, messages } = fixtureState();

        // Seed existing positions in the in-memory SQLite table.
        yield* Effect.forEach(
          items,
          (item) => sql`
            INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
            VALUES (${item.threadId}, ${item.id}, ${item.ordinal})
          `,
          { concurrency: 1 },
        );

        const plan = planMirror({
          base,
          ops: [
            { kind: "moveUnit", unit: "a4", toIndex: 1 },
            {
              kind: "insertMessage",
              role: "assistant",
              text: "between u1 and a4",
              index: 1,
              uuid: "n-mid",
              timestamp: "2026-11-25T10:00:01.500Z",
              messageId: null,
            },
          ],
          items,
          messages,
          threadId: THREAD_ID,
          providerThreadId: PROVIDER_THREAD_ID,
          now: NOW,
          newId: makeNewId,
        });

        yield* Effect.forEach(
          plan.positions,
          (pos) => sql`
            INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
            VALUES (${THREAD_ID}, ${pos.turnItemId}, ${pos.ordinal})
            ON CONFLICT(thread_id, turn_item_id) DO UPDATE SET ordinal = excluded.ordinal
          `,
          { concurrency: 1 },
        );

        // TurnItemPositionStore.normalize must preserve every planned ordinal inside run 1.
        const normalized = yield* Effect.forEach(
          plan.items,
          (item) => positionStore.normalize(item, item.runId === RUN_1 ? 1 : 2),
          { concurrency: 1 },
        );
        assert.deepEqual(
          normalized.map((i) => [i.id, i.ordinal]),
          plan.items.map((i) => [i.id, i.ordinal]),
        );

        const rows = yield* sql<{ readonly turn_item_id: string; readonly ordinal: number }>`
          SELECT turn_item_id, ordinal
          FROM orchestration_v2_turn_item_positions
          WHERE thread_id = ${THREAD_ID}
          ORDER BY ordinal ASC
        `;
        assert.deepEqual(
          rows.map((r) => [r.turn_item_id, r.ordinal]),
          [
            ["item:u1", 1_000_001],
            ["new:item:n-mid", 1_000_002],
            ["new:item:a4", 1_000_003],
            ["item:a1t", 1_000_004],
            ["item:a1", 1_000_005],
            ["item:tool1", 1_000_006],
            ["item:a3", 1_000_007],
            ["item:u2", 2_000_001],
            ["item:a4", 2_000_002],
          ],
        );
      }).pipe(Effect.provide(positionLayer)),
  );
});
