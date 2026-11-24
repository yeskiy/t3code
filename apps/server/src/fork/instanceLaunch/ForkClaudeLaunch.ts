import type { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { parseCliArgs } from "@t3tools/shared/cliArgs";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { claudeLaunchArgParseOptions } from "../../provider/Drivers/ClaudeSkills.ts";
import { parseMcpConfigFileList, writeMergedMcpConfig } from "./mcpConfigMerge.ts";
import { runPrepareCommand } from "./prepareCommand.ts";

export interface ForkClaudeLaunch {
  readonly mcpConfigPath?: string;
  readonly disallowedTools?: ReadonlyArray<string>;
  readonly appendText?: string;
  readonly nativeAgentOff: boolean;
}

export interface ForkClaudeAgentParts {
  readonly appendText: string;
  readonly disallowedTools: ReadonlyArray<string>;
}

const DISALLOWED_FLAGS = ["disallowedTools", "disallowed-tools"] as const;

export const launchArgDisallowedTools = (launchArgs: string): ReadonlyArray<string> => {
  const flags = parseCliArgs(launchArgs, claudeLaunchArgParseOptions).flags;
  return DISALLOWED_FLAGS.flatMap((flag) => flags[flag]?.split(/[\s,]+/).filter(Boolean) ?? []);
};

export const forkExtraArgsOption = (
  extraArgs: Record<string, string | null>,
  launch: ForkClaudeLaunch | undefined,
): { readonly extraArgs?: Record<string, string | null> } => {
  const next = Object.fromEntries([
    ...Object.entries(extraArgs).filter(
      ([flag]) =>
        launch?.disallowedTools === undefined ||
        !(DISALLOWED_FLAGS as ReadonlyArray<string>).includes(flag),
    ),
    ...(launch?.mcpConfigPath === undefined ? [] : [["mcp-config", launch.mcpConfigPath] as const]),
  ]);
  return Object.keys(next).length === 0 ? {} : { extraArgs: next };
};

export const forkDisallowedToolsOption = (
  disallowedTools: ReadonlyArray<string> | undefined,
  launch: ForkClaudeLaunch | undefined,
): { readonly disallowedTools?: Array<string> } => {
  const merged = [...new Set([...(disallowedTools ?? []), ...(launch?.disallowedTools ?? [])])];
  return merged.length === 0 ? {} : { disallowedTools: merged };
};

export const makeForkClaudeLaunchResolver = Effect.fn("fork.makeClaudeLaunchResolver")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly settings: ClaudeSettings;
    readonly environment: NodeJS.ProcessEnv;
    readonly stateDir: string;
  }) {
    const services = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
    >();
    const path = yield* Path.Path;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const prepareLock = yield* Semaphore.make(1);
    const launchDisallowed = launchArgDisallowedTools(input.settings.launchArgs);
    const launchArgMcp = parseCliArgs(input.settings.launchArgs, claudeLaunchArgParseOptions).flags[
      "mcp-config"
    ];
    const mcpFiles = parseMcpConfigFileList(input.settings.mcpConfigFiles);
    const prepareCommand = input.settings.prepareCommand.trim();
    const resolve = Effect.fn("fork.claudeLaunch.resolve")(
      function* (request: { readonly cwd: string | null; readonly agent?: ForkClaudeAgentParts }) {
        if (prepareCommand !== "") {
          yield* prepareLock.withPermits(1)(
            runPrepareCommand({
              command: prepareCommand,
              cwd: request.cwd ?? homeDirectory,
              environment: input.environment,
            }),
          );
        }
        const mcpConfigPath =
          mcpFiles.length === 0
            ? undefined
            : yield* writeMergedMcpConfig({
                files:
                  typeof launchArgMcp === "string" && launchArgMcp !== ""
                    ? [launchArgMcp, ...mcpFiles]
                    : mcpFiles,
                homeDirectory,
                outputPath: path.join(input.stateDir, "fork", "mcp", `${input.instanceId}.json`),
              });
        const disallowedTools = [
          ...new Set([...launchDisallowed, ...(request.agent?.disallowedTools ?? [])]),
        ];
        return {
          ...(mcpConfigPath === undefined ? {} : { mcpConfigPath }),
          ...(disallowedTools.length === 0 ? {} : { disallowedTools }),
          ...(request.agent === undefined ? {} : { appendText: request.agent.appendText }),
          nativeAgentOff: launchDisallowed.includes("Agent"),
        } satisfies ForkClaudeLaunch;
      },
      (effect) => effect.pipe(Effect.provide(services)),
    );
    return { resolve };
  },
);

export type ForkClaudeLaunchResolver = Effect.Success<
  ReturnType<typeof makeForkClaudeLaunchResolver>
>;
