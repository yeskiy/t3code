#!/usr/bin/env node
// Usage: node fork/e2e/transcript-edit/run.ts [--headed] [--dir <folder>] [--port-offset <n>]
// Starts the dev stack on a fresh home under the e2e folder, imports two fixture Claude
// sessions, and drives the transcript editing checklist in Chromium. Nothing calls a model.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { makeRunDirs, startApp } from "./app.ts";
import { writeFixtures } from "./fixtures.ts";
import { runSteps } from "./steps.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    headed: { type: "boolean", default: false },
    dir: { type: "string", default: process.env.T3FORK_E2E_DIR ?? "E:/t3fork/e2e" },
    "port-offset": { type: "string", default: "4200" },
  },
});

const repo = NodePath.resolve(import.meta.dirname, "../../..");
const playwright = NodeModule.createRequire(NodePath.join(repo, "apps/web/package.json"))(
  "playwright",
) as typeof import("playwright");

const dirs = makeRunDirs(values.dir);
const logFile = NodePath.join(dirs.root, "e2e.log");
const log = (line: string) => {
  NodeFS.appendFileSync(logFile, `${line}\n`);
  process.stdout.write(`${line}\n`);
};
const results: Array<{ readonly name: string; readonly ok: boolean; readonly ms: number }> = [];

log(`e2e folder: ${dirs.root}`);
const files = writeFixtures(dirs.claude, dirs.workspace);
const app = await startApp({
  repo,
  dirs,
  portOffset: Number(values["port-offset"]),
  log,
});
const browser = await playwright.chromium.launch({ headless: !values.headed });
const exitCode = await (async () => {
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    // A large session file makes the preview slow. A step sets this delay to act inside that window.
    const previewDelay = { ms: 0 };
    await context.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        const text = typeof message === "string" ? message : message.toString("latin1");
        const send = () => server.send(message);
        if (previewDelay.ms > 0 && text.includes("fork.transcriptEdit.preview")) {
          setTimeout(send, previewDelay.ms);
        } else {
          send();
        }
      });
      server.onMessage((message) => ws.send(message));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const readEnvironment = async (tries: number): Promise<{ readonly environmentId: string }> => {
      try {
        return (await (await fetch(`${app.serverUrl}/.well-known/t3/environment`)).json()) as {
          readonly environmentId: string;
        };
      } catch (error) {
        if (tries <= 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return readEnvironment(tries - 1);
      }
    };
    const environment = await readEnvironment(30);
    await page.goto(app.pairUrl);
    await page.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 60_000 });
    await runSteps({
      page,
      webUrl: app.webUrl,
      environmentId: environment.environmentId,
      chatFile: files.chat,
      compactFile: files.compact,
      backupsDir: NodePath.join(dirs.home, "userdata", "fork", "transcript-edit", "backups"),
      setPreviewDelay: (ms) => {
        previewDelay.ms = ms;
      },
      step: async (name, run) => {
        const started = Date.now();
        try {
          await run();
          results.push({ name, ok: true, ms: Date.now() - started });
          log(`PASS ${name} (${Date.now() - started} ms)`);
        } catch (error) {
          results.push({ name, ok: false, ms: Date.now() - started });
          log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          NodeFS.writeFileSync(NodePath.join(dirs.root, "failure.html"), await page.content());
          throw error;
        }
      },
    });
    return 0;
  } catch (error) {
    log(`ERROR ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return 1;
  } finally {
    await browser.close();
    app.stop();
  }
})();

const passed = results.filter((result) => result.ok).length;
log(
  `${exitCode === 0 ? "PASSED" : "FAILED"}: ${passed} of ${results.length} steps. Log: ${logFile}`,
);
process.exit(exitCode);
