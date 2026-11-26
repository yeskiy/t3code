import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface RunDirs {
  readonly root: string;
  readonly home: string;
  readonly claude: string;
  readonly codex: string;
  readonly workspace: string;
}

export interface App {
  readonly serverUrl: string;
  readonly webUrl: string;
  readonly pairUrl: string;
  readonly stop: () => void;
}

// oxlint-disable-next-line t3code/no-global-process-runtime -- this script has no Effect runtime and stops real host processes.
const WINDOWS = NodeOS.platform() === "win32";

const FORBIDDEN = [".t3", ".claude", ".claude-pag"].map((name) =>
  NodePath.resolve(NodeOS.homedir(), name).toLowerCase(),
);

const inside = (child: string, parent: string) => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

/** Makes a fresh run folder and refuses any path inside the real T3 or Claude homes. */
export const makeRunDirs = (base: string): RunDirs => {
  const root = NodePath.resolve(base, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const blocked = FORBIDDEN.find((forbidden) => inside(root.toLowerCase(), forbidden));
  if (blocked !== undefined) throw new Error(`The e2e folder ${root} is inside ${blocked}.`);
  if (NodeFS.existsSync(root)) throw new Error(`The e2e folder ${root} exists already.`);
  const dirs = {
    root,
    home: NodePath.join(root, "home"),
    claude: NodePath.join(root, "claude"),
    codex: NodePath.join(root, "codex"),
    workspace: NodePath.join(root, "workspace"),
  };
  [dirs.home, dirs.claude, dirs.codex, dirs.workspace].forEach((dir) =>
    NodeFS.mkdirSync(dir, { recursive: true }),
  );
  NodeFS.mkdirSync(NodePath.join(dirs.home, "userdata"));
  // Codex is off, so the app shows no Codex error banner and never starts a Codex process.
  NodeFS.writeFileSync(
    NodePath.join(dirs.home, "userdata", "settings.json"),
    JSON.stringify({ providerInstances: { codex: { driver: "codex", enabled: false } } }),
  );
  NodeFS.writeFileSync(NodePath.join(dirs.workspace, "README.md"), "# e2e workspace\n");
  return dirs;
};

const killTree = (pid: number) => {
  if (WINDOWS) {
    NodeChildProcess.spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // The process group ended already.
  }
};

const waitFor = async <A>(what: string, timeoutMs: number, read: () => A | null): Promise<A> => {
  const end = Date.now() + timeoutMs;
  const poll = async (): Promise<A> => {
    const value = read();
    if (value !== null) return value;
    if (Date.now() > end) throw new Error(`Timed out after ${timeoutMs} ms: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return poll();
  };
  return poll();
};

/** Starts `scripts/dev-runner.ts dev` on the run folder and waits until server and web answer. */
export const startApp = async (input: {
  readonly repo: string;
  readonly dirs: RunDirs;
  readonly portOffset: number;
  readonly log: (line: string) => void;
}): Promise<App> => {
  const logFile = NodePath.join(input.dirs.root, "dev.log");
  const out = NodeFS.openSync(logFile, "a");
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: input.dirs.claude,
    CODEX_HOME: input.dirs.codex,
    T3CODE_PORT_OFFSET: String(input.portOffset),
    T3CODE_DEV_SEED: "0",
  };
  delete env.T3CODE_HOME;
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      "scripts/dev-runner.ts",
      "dev",
      "--home-dir",
      input.dirs.home,
      "--no-seed",
      "--no-auto-bootstrap-project-from-cwd",
    ],
    {
      cwd: input.repo,
      env,
      stdio: ["ignore", out, out],
      detached: !WINDOWS,
      windowsHide: true,
    },
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error("The dev runner did not start.");
  const stop = () => killTree(pid);
  input.log(`dev stack: pid ${pid}, log ${logFile}`);
  try {
    const text = () => NodeFS.readFileSync(logFile, "utf8");
    const ports = await waitFor("the dev runner ports", 120_000, () => {
      if (child.exitCode !== null) throw new Error(`The dev runner exited. See ${logFile}`);
      const match = /serverPort=(\d+) webPort=(\d+)/.exec(text());
      return match === null ? null : { server: Number(match[1]), web: Number(match[2]) };
    });
    await waitFor("the server to listen", 600_000, () => {
      if (child.exitCode !== null) throw new Error(`The dev runner exited. See ${logFile}`);
      return text().includes(`Listening on http://127.0.0.1:${ports.server}`) ? true : null;
    });
    const pairUrl = await waitFor("the pairing link", 60_000, () => {
      const match = /https?:\/\/[^\s]+\/pair#[^\s]+/.exec(text());
      return match === null ? null : match[0];
    });
    const webUrl = `http://localhost:${ports.web}`;
    await waitFor("the web app to answer", 120_000, () => {
      const probe = NodeChildProcess.spawnSync(
        process.execPath,
        [
          "-e",
          `fetch(${JSON.stringify(webUrl)}).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`,
        ],
        { stdio: "ignore" },
      );
      return probe.status === 0 ? true : null;
    });
    input.log(`dev stack: server ${ports.server}, web ${ports.web}`);
    return { serverUrl: `http://127.0.0.1:${ports.server}`, webUrl, pairUrl, stop };
  } catch (error) {
    stop();
    throw error;
  }
};
