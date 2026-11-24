import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Fork fields of a Claude instance: MCP files to merge and a command that runs before each Claude process. */
export const ForkClaudeLaunchSettingsFields = {
  mcpConfigFiles: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: "MCP config files",
      description:
        "One JSON file per line. T3 merges their mcpServers in order, a later file wins, and passes the result with --mcp-config.",
      providerSettingsForm: {
        control: "textarea",
        placeholder: "C:\\Users\\me\\mcp\\common.json",
        clearWhenEmpty: "omit",
      },
    }),
  ),
  prepareCommand: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: "Prepare command",
      description:
        "Runs in a shell before T3 starts a Claude process. A non-zero exit code or 120 s without an exit fails the turn.",
      providerSettingsForm: {
        placeholder: "powershell -NoProfile -File prepare.ps1",
        clearWhenEmpty: "omit",
      },
    }),
  ),
} as const;

export const FORK_CLAUDE_LAUNCH_SETTINGS_ORDER = ["mcpConfigFiles", "prepareCommand"] as const;
