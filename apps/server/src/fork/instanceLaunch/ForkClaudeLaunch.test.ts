import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  forkDisallowedToolsOption,
  forkExtraArgsOption,
  launchArgDisallowedTools,
  makeForkClaudeLaunchResolver,
} from "./ForkClaudeLaunch.ts";

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

describe("launchArgDisallowedTools", () => {
  it("reads both flag spellings and splits commas and spaces", () => {
    expect(
      launchArgDisallowedTools('--disallowedTools "Agent, Workflow" --disallowed-tools Bash'),
    ).toEqual(["Agent", "Workflow", "Bash"]);
  });
});

describe("forkExtraArgsOption", () => {
  it("replaces --mcp-config and drops the disallowed tools flags when the fork sets them", () => {
    expect(
      forkExtraArgsOption(
        { "mcp-config": "old.json", disallowedTools: "Agent", chrome: null },
        { mcpConfigPath: "new.json", disallowedTools: ["Agent"], nativeAgentOff: true },
      ),
    ).toEqual({ extraArgs: { "mcp-config": "new.json", chrome: null } });
  });

  it("keeps the upstream value when there is no fork launch", () => {
    expect(forkExtraArgsOption({}, undefined)).toEqual({});
  });
});

describe("forkDisallowedToolsOption", () => {
  it("joins the upstream and fork lists without duplicates", () => {
    expect(
      forkDisallowedToolsOption(["Write"], {
        disallowedTools: ["Agent", "Write"],
        nativeAgentOff: true,
      }),
    ).toEqual({
      disallowedTools: ["Write", "Agent"],
    });
  });
});

describe("makeForkClaudeLaunchResolver", () => {
  it.live("merges launch-arg and instance MCP files and runs the prepare command", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-launch-resolver-" });
        const baseMcp = path.join(dir, "base.json");
        const layerMcp = path.join(dir, "layer.json");
        const stamp = path.join(dir, "prepared.txt");
        yield* fs.writeFileString(
          baseMcp,
          JSON.stringify({ mcpServers: { shared: { command: "base" }, kept: { command: "k" } } }),
        );
        yield* fs.writeFileString(
          layerMcp,
          JSON.stringify({ mcpServers: { shared: { command: "layer" } } }),
        );
        const script = `require("node:fs").writeFileSync(${JSON.stringify(stamp)}, "ok")`;
        const settings = yield* decodeClaudeSettings({
          launchArgs: `--mcp-config ${JSON.stringify(baseMcp)} --disallowedTools Agent`,
          mcpConfigFiles: `${layerMcp}\n`,
          prepareCommand: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
        });
        const resolver = yield* makeForkClaudeLaunchResolver({
          instanceId: ProviderInstanceId.make("claudeWork"),
          settings,
          environment: process.env,
          stateDir: dir,
        });

        const launch = yield* resolver.resolve({
          cwd: dir,
          agent: { appendText: "ROLE TEXT", disallowedTools: ["Write"] },
        });
        expect(launch.nativeAgentOff).toBe(true);
        expect(launch.disallowedTools).toEqual(["Agent", "Write"]);
        expect(launch.appendText).toBe("ROLE TEXT");
        expect(launch.mcpConfigPath).toBe(path.join(dir, "fork", "mcp", "claudeWork.json"));
        expect(yield* fs.readFileString(stamp)).toBe("ok");
        expect(JSON.parse(yield* fs.readFileString(launch.mcpConfigPath!))).toEqual({
          mcpServers: { shared: { command: "layer" }, kept: { command: "k" } },
        });
      }),
    ).pipe(
      Effect.provideService(HostProcess.HomeDirectory, process.cwd()),
      Effect.provide(NodeServices.layer),
    ),
  );
});
