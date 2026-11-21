import * as Schema from "effect/Schema";

export const FORK_NEW_THREAD_DEFAULT_KEY = "t3code:fork:new-thread-default:v1";
export const ForkNewThreadDefault = Schema.Literals(["scratch", "lastUsed"]);
export type ForkNewThreadDefault = typeof ForkNewThreadDefault.Type;
export const FORK_NEW_THREAD_DEFAULT: ForkNewThreadDefault = "scratch";

// "wait" holds the landing until an environment can offer the No project folder.
export function decideForkLanding(input: {
  readonly setting: ForkNewThreadDefault;
  readonly environmentsReady: boolean;
  readonly scratchEnvironmentId: string | null;
  readonly shiftKey?: boolean;
}): "scratch" | "upstream" | "wait" {
  if (input.setting !== "scratch" || input.shiftKey === true) return "upstream";
  if (input.scratchEnvironmentId !== null) return "scratch";
  return input.environmentsReady ? "upstream" : "wait";
}
