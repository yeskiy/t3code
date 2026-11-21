import * as Schema from "effect/Schema";

import { isWindowsPlatform } from "~/lib/utils";

export const FORK_SHARP_TEXT_KEY = "t3code:fork:sharp-text:v1";
export const ForkSharpTextStored = Schema.NullOr(Schema.Boolean);

export const resolveForkSharpText = (stored: boolean | null, platform: string) =>
  isWindowsPlatform(platform) && (stored ?? true);
