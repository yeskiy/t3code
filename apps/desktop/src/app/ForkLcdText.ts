const LCD_SWITCHES = ["enable-lcd-text", "disable-prefer-compositing-to-lcd-text"] as const;

// fork: ClearType text on Windows without shortcut arguments. T3_FORK_LCD_TEXT=0 turns it off.
export function applyForkLcdTextSwitches(input: {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly commandLine: {
    readonly hasSwitch: (name: string) => boolean;
    readonly appendSwitch: (name: string) => void;
  };
}): ReadonlyArray<string> {
  if (input.platform !== "win32" || input.env.T3_FORK_LCD_TEXT?.trim() === "0") return [];
  const missing = LCD_SWITCHES.filter((name) => !input.commandLine.hasSwitch(name));
  missing.forEach((name) => input.commandLine.appendSwitch(name));
  return missing;
}
