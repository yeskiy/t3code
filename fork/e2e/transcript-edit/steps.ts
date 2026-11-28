import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { Locator, Page } from "playwright";

import { CHAT_SESSION_ID, COMPACT_SESSION_ID } from "./fixtures.ts";

export interface StepContext {
  readonly page: Page;
  readonly webUrl: string;
  readonly environmentId: string;
  readonly chatFile: string;
  readonly compactFile: string;
  readonly backupsDir: string;
  readonly setPreviewDelay: (ms: number) => void;
  readonly step: (name: string, run: () => Promise<void>) => Promise<void>;
}

const until = async (what: string, check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const end = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await check().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return poll();
  };
  return poll();
};

const equal = (what: string, actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const threadUrl = (ctx: StepContext, sessionId: string) =>
  `${ctx.webUrl}/${ctx.environmentId}/${encodeURIComponent(`import:claudeAgent:${sessionId}`)}`;

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
const pendingCount = async (page: Page) => {
  const match = /(\d+) pending changes?/.exec(await bodyText(page));
  return match === null ? 0 : Number(match[1]);
};
const expectPending = (page: Page, count: number) =>
  until(`${count} pending changes`, async () => (await pendingCount(page)) === count);

const row = (page: Page, text: string) =>
  page.locator("[data-timeline-row-id]", { hasText: text }).first();
const selectable = (page: Page, text: string) =>
  page.locator("[data-fork-transcript-select-keys]", { hasText: text }).last();
const checkbox = (page: Page, text: string) =>
  selectable(page, text).locator("[data-fork-transcript-select-checkbox]").first();
const banner = (page: Page) => page.locator("[data-composer-banner-stack]").first();
const selectBar = (page: Page) => page.locator("[data-fork-transcript-select-bar]");
const barAction = (page: Page, name: string) =>
  selectBar(page).locator(`[data-fork-transcript-select-action="${name}"]`);
const selectCount = (page: Page) => page.locator("[data-fork-transcript-select-count]").innerText();
const selectedCount = async (page: Page) => {
  const text = await selectCount(page);
  return text === "None selected" ? 0 : Number(/^(\d+)/.exec(text)?.[1] ?? "-1");
};
const expectSelected = (page: Page, count: number) =>
  until(`${count} selected`, async () => (await selectedCount(page)) === count, 5_000);
const validation = async (page: Page) =>
  /Validation passed\.|A change cannot apply\.|\d+ errors?/.exec(await bodyText(page))?.[0] ?? null;
const expectApplies = async (page: Page) => {
  await until("the preview to finish", async () => (await validation(page)) !== null);
  // The preview runs after a short delay, so the check waits for the newest one.
  await page.waitForTimeout(600);
  equal("validation", await validation(page), "Validation passed.");
};

const openEditForm = async (page: Page, text: string): Promise<Locator> => {
  const target = row(page, text);
  await target.hover();
  await target.locator("[data-fork-transcript-edit-button]").first().click();
  const form = page.locator("[data-fork-transcript-edit-form]").first();
  await form.waitFor({ state: "visible" });
  return form;
};

const formMenu = async (page: Page, form: Locator, item: string) => {
  await form.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};

const startSelect = async (page: Page) => {
  await page
    .locator("[data-timeline-row-id]")
    .first()
    .click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Control+Alt+s");
  await selectBar(page).waitFor({ state: "visible" });
  await until(
    "checkboxes",
    async () => (await page.locator("[data-fork-transcript-select-checkbox]").count()) > 0,
  );
};

const endSelect = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await selectBar(page).waitFor({ state: "detached" });
};

const dragGrip = async (page: Page, from: string, to: string, side: "before" | "after") => {
  const source = selectable(page, from);
  await source.hover();
  const grip = await source.locator("[data-fork-transcript-drag-handle]").boundingBox();
  const target = await selectable(page, to).boundingBox();
  if (grip === null || target === null) throw new Error("No drag grip or drop target box.");
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  await page.mouse.move(
    target.x + 80,
    side === "after" ? target.y + target.height - 4 : target.y + 4,
    {
      steps: 12,
    },
  );
  await until(
    "a drop line",
    async () => (await page.locator("[data-fork-transcript-drop-line]").count()) > 0,
    5_000,
  );
  await page.mouse.up();
};

const discardAll = async (page: Page) => {
  await banner(page).getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expectPending(page, 0);
};

const save = async (page: Page) => {
  await banner(page).getByRole("button", { name: "Save", exact: true }).click();
  await until("the save toast", async () => (await bodyText(page)).includes("Saved."), 30_000);
  await expectPending(page, 0);
};

interface Entry {
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly message?: { readonly content?: unknown };
}

// The conversation in chain order: from the last leaf back along parentUuid, then reversed.
const conversationText = (file: string) => {
  const entries = NodeFS.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Entry)
    .filter((entry) => entry.uuid !== undefined);
  const byUuid = new Map(entries.map((entry) => [entry.uuid, entry] as const));
  const parents = new Set(entries.map((entry) => entry.parentUuid));
  const walk = (entry: Entry | undefined, acc: ReadonlyArray<Entry>): ReadonlyArray<Entry> =>
    entry === undefined ? acc : walk(byUuid.get(entry.parentUuid ?? undefined), [entry, ...acc]);
  return walk(
    entries.findLast((entry) => !parents.has(entry.uuid)),
    [],
  )
    .map((entry) => JSON.stringify(entry.message?.content ?? null))
    .join("\n");
};

/** One round of every Select option. Each round ends with Select mode off. */
const selectRound = async (ctx: StepContext, label: string) => {
  const { page, step } = ctx;
  const marks = { start: await pendingCount(page) };
  await step(`${label}: start Select mode with Ctrl+Alt+S`, () => startSelect(page));
  await step(`${label}: select one message`, async () => {
    await checkbox(page, "Rename the greeting function.").click();
    await expectSelected(page, 1);
  });
  await step(`${label}: extend with Shift+ArrowDown`, async () => {
    await page.keyboard.press("Shift+ArrowDown");
    await expectSelected(page, 2);
  });
  await step(`${label}: select all with Ctrl+A`, async () => {
    await page.keyboard.press("Control+a");
    await until(
      "all selected",
      async () => /^(\d+) of \1 selected$/.test(await selectCount(page)),
      5_000,
    );
  });
  await step(`${label}: clear with Escape and with the Clear button`, async () => {
    await page.keyboard.press("Escape");
    await expectSelected(page, 0);
    await selectBar(page).getByRole("button", { name: "Select all" }).click();
    await selectBar(page).getByRole("button", { name: "Clear" }).click();
    await expectSelected(page, 0);
  });
  await step(`${label}: Shift+click a range of row bodies`, async () => {
    await selectable(page, "Rename the greeting function.")
      .locator("[data-fork-transcript-select-content]")
      .click({ position: { x: 200, y: 8 } });
    await selectable(page, "Summarize the changes.")
      .locator("[data-fork-transcript-select-content]")
      .click({ position: { x: 200, y: 8 }, modifiers: ["Shift"] });
    if ((await selectedCount(page)) < 2)
      throw new Error(`Shift+click selected ${await selectCount(page)}`);
    await page.keyboard.press("Escape");
  });
  await step(
    `${label}: move with Alt+ArrowUp, then at once with the Move down button`,
    async () => {
      const before = await pendingCount(page);
      await checkbox(page, "Rename the greeting function.").click();
      await page.keyboard.press("Alt+ArrowUp");
      await barAction(page, "Move down").click();
      await expectPending(page, before + 2);
      await expectApplies(page);
      // The keys must still reach the timeline after a bar button press.
      await page.keyboard.press("Shift+ArrowDown");
      await expectSelected(page, 2);
      await page.keyboard.press("Escape");
      await checkbox(page, "Rename the greeting function.").click();
    },
  );
  await step(`${label}: move with Move up, twice in a row`, async () => {
    const before = await pendingCount(page);
    await barAction(page, "Move up").click();
    await barAction(page, "Move up").click();
    await expectPending(page, before + 2);
    await expectApplies(page);
  });
  await step(`${label}: Move to... the start of the transcript`, async () => {
    const before = await pendingCount(page);
    await barAction(page, "Move to...").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Put at the start" }).click();
    await expectPending(page, before + 1);
    await expectApplies(page);
  });
  await step(`${label}: drag the grip below another row`, async () => {
    const before = await pendingCount(page);
    await dragGrip(page, "Summarize the changes.", "List the files in the project.", "after");
    await expectPending(page, before + 1);
    await expectApplies(page);
  });
  await step(
    `${label}: delete with the Delete key, then at once move another message`,
    async () => {
      const before = await pendingCount(page);
      await page.keyboard.press("Escape");
      await checkbox(page, "Summarize the changes.").click();
      await page.keyboard.press("Delete");
      await checkbox(page, "Rename the greeting function.").click();
      await page.keyboard.press("Alt+ArrowDown");
      await until("the delete step", async () => (await pendingCount(page)) >= before + 1);
      await expectApplies(page);
    },
  );
  await step(`${label}: delete with the Delete button`, async () => {
    const before = await pendingCount(page);
    await page.keyboard.press("Escape");
    await checkbox(page, "Rename the greeting function.").click();
    await barAction(page, "Delete").click();
    await expectPending(page, before + 1);
    await expectApplies(page);
    // Delete anchors the next message, and Shift+ArrowDown selects it with no click.
    await page.keyboard.press("Shift+ArrowDown");
    await expectSelected(page, 1);
    await page.keyboard.press("Escape");
  });
  await step(`${label}: undo and redo inside Select mode`, async () => {
    const before = await pendingCount(page);
    const active = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160));
    await page.keyboard.press("Control+z");
    await expectPending(page, before - 1).catch((error: Error) => {
      throw new Error(`${error.message}. Focus: ${active}`);
    });
    await page.keyboard.press("Control+Shift+z");
    await expectPending(page, before);
    await checkbox(page, "friendly greeting to index.ts.").click();
    await page.keyboard.press("Shift+ArrowDown");
    await expectSelected(page, 2);
    await expectApplies(page);
  });
  await step(`${label}: undo every step of the round with Ctrl+Z`, async () => {
    const undo = async (): Promise<void> => {
      if ((await pendingCount(page)) <= marks.start) return;
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(100);
      return undo();
    };
    await undo();
    await expectPending(page, marks.start);
  });
  await step(`${label}: end Select mode with Escape twice`, () => endSelect(page));
};

export const runSteps = async (ctx: StepContext) => {
  const { page, step } = ctx;
  const original = NodeFS.readFileSync(ctx.chatFile, "utf8");

  await step("import the fixture project from the welcome page", async () => {
    await page.goto(`${ctx.webUrl}/welcome`);
    await page
      .getByRole("checkbox", { name: /Import .*projects? and their threads/ })
      .first()
      .check();
    await page.getByRole("button", { name: /Import 1 project and start/ }).click();
    await page.waitForURL(/\/draft\//, { timeout: 60_000 });
  });

  await step("open the imported Claude thread", async () => {
    await page.goto(threadUrl(ctx, CHAT_SESSION_ID));
    await row(page, "Summarize the changes.").waitFor({ state: "visible", timeout: 60_000 });
  });

  await step("edit a message in place", async () => {
    const form = await openEditForm(page, "Add a greeting to index.ts.");
    await form.locator("textarea").first().fill("Add a friendly greeting to index.ts.");
    await page.keyboard.press("Control+Enter");
    await expectPending(page, 1);
    await row(page, "Add a friendly greeting to index.ts.").waitFor({ state: "visible" });
  });

  await step("insert a message below", async () => {
    const form = await openEditForm(page, "Explain the greeting.");
    await formMenu(page, form, "Insert a message below");
    const composer = page.locator("[data-fork-transcript-insert-composer]").first();
    await composer.locator("textarea").fill("An inserted e2e message.");
    await page.keyboard.press("Control+Enter");
    await expectPending(page, 2);
    await until("the inserted draft", async () =>
      (await bodyText(page)).includes("An inserted e2e message."),
    );
  });

  await step("delete a message from the edit form", async () => {
    const form = await openEditForm(page, "Explain the greeting.");
    await formMenu(page, form, "Delete");
    await expectPending(page, 3);
  });

  await step("move a message up from the edit form", async () => {
    const form = await openEditForm(page, "Rename the greeting function.");
    await formMenu(page, form, "Move up");
    await expectPending(page, 4);
    await expectApplies(page);
  });

  await step("undo and redo with the save bar buttons", async () => {
    await banner(page).getByRole("button", { name: /^Undo/ }).click();
    await expectPending(page, 3);
    await banner(page).getByRole("button", { name: /^Redo/ }).click();
    await expectPending(page, 4);
  });

  await step("open the review dialog", async () => {
    await banner(page).getByRole("button", { name: "Review changes", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Review changes" });
    await dialog.waitFor({ state: "visible" });
    const text = await dialog.innerText();
    ["4 changes", "Edited", "Removed", "Moved", "An inserted e2e message."].forEach((part) => {
      if (!text.includes(part)) throw new Error(`The review dialog does not show "${part}".`);
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  });

  await step("save and check the session file and the backup", async () => {
    await save(page);
    const saved = conversationText(ctx.chatFile);
    if (!saved.includes("Add a friendly greeting to index.ts."))
      throw new Error("The edit is not saved.");
    if (!saved.includes("An inserted e2e message.")) throw new Error("The insert is not saved.");
    if (saved.includes("Explain the greeting."))
      throw new Error("The deleted message is still there.");
    const backups = NodeFS.readdirSync(NodePath.join(ctx.backupsDir, CHAT_SESSION_ID));
    equal("backup count", backups.length, 1);
  });

  await step("a delete and a move before the preview returns", async () => {
    await startSelect(page);
    await checkbox(page, "Summarize the changes.").click();
    await page.keyboard.press("Shift+ArrowDown");
    await expectSelected(page, 2);
    ctx.setPreviewDelay(2_000);
    await page.keyboard.press("Delete");
    // The reply above the deleted pair is now the last unit, so Move down has nothing to do.
    await checkbox(page, "I renamed the function to sayHello.").click();
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowUp");
    ctx.setPreviewDelay(0);
    await expectApplies(page);
    await expectPending(page, 2);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await expectPending(page, 0);
    await endSelect(page);
  });

  await selectRound(ctx, "round 1");
  await selectRound(ctx, "round 2 after exit and start");

  await step("discard Select mode changes", async () => {
    await startSelect(page);
    await checkbox(page, "Rename the greeting function.").click();
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Delete");
    await expectPending(page, 2);
    await discardAll(page);
    await selectBar(page).waitFor({ state: "detached" });
  });
  await selectRound(ctx, "round 3 after Discard");

  await step("save a move made in Select mode", async () => {
    await startSelect(page);
    await checkbox(page, "Summarize the changes.").click();
    await page.keyboard.press("Alt+ArrowUp");
    await expectPending(page, 1);
    await expectApplies(page);
    await save(page);
    const order = conversationText(ctx.chatFile);
    if (
      order.indexOf("Summarize the changes.") > order.indexOf("I renamed the function to sayHello.")
    ) {
      throw new Error("The saved file does not hold the move.");
    }
    equal(
      "backup count",
      NodeFS.readdirSync(NodePath.join(ctx.backupsDir, CHAT_SESSION_ID)).length,
      2,
    );
  });
  await selectRound(ctx, "round 4 after Save");

  await step("restore the first backup from the thread menu", async () => {
    const dir = NodePath.join(ctx.backupsDir, CHAT_SESSION_ID);
    const first = NodeFS.readdirSync(dir).find(
      (name) => NodeFS.readFileSync(NodePath.join(dir, name), "utf8") === original,
    );
    if (first === undefined) throw new Error("No backup holds the original session file.");
    await page.getByRole("button", { name: /^Thread actions for/ }).click();
    await page.getByRole("menuitem", { name: "Transcript backups" }).click();
    const dialog = page.getByRole("dialog", { name: "Transcript backups" });
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: `Restore ${first}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
    await until(
      "the restore toast",
      async () => (await bodyText(page)).includes("Restored."),
      30_000,
    );
    equal(
      "restored conversation",
      conversationText(ctx.chatFile),
      conversationText(NodePath.join(dir, first)),
    );
    await page.keyboard.press("Escape");
  });

  await step("Select mode in a thread with a compact boundary", async () => {
    await page.goto(threadUrl(ctx, COMPACT_SESSION_ID));
    await row(page, "Second question after compaction.").waitFor({
      state: "visible",
      timeout: 60_000,
    });
    await startSelect(page);
    await checkbox(page, "Second question after compaction.").click();
    await page.keyboard.press("Alt+ArrowUp");
    await expectPending(page, 1);
    await expectApplies(page);
    await page.keyboard.press("Control+a");
    await until(
      "all selected",
      async () => /^(\d+) of \1 selected$/.test(await selectCount(page)),
      5_000,
    );
    const boundary = NodeFS.readFileSync(ctx.compactFile, "utf8").includes("compact_boundary");
    if (!boundary) throw new Error("The compact boundary entry is missing from the file.");
    await endSelect(page);
    await discardAll(page);
  });

  await step("block a save that removes every message", async () => {
    const before = NodeFS.readFileSync(ctx.compactFile, "utf8");
    await startSelect(page);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await until("the validation error", async () => (await validation(page)) === "1 error");
    const saveButton = banner(page).getByRole("button", { name: "Save", exact: true });
    equal("Save disabled", await saveButton.isDisabled(), true);
    await banner(page).getByRole("button", { name: "1 error" }).click();
    await until("the error text", async () =>
      (await bodyText(page)).includes("The edit removes every user and assistant message."),
    );
    equal("session file", NodeFS.readFileSync(ctx.compactFile, "utf8"), before);
    await page.keyboard.press("Escape");
    await discardAll(page);
    await selectBar(page).waitFor({ state: "detached" });
  });
};
