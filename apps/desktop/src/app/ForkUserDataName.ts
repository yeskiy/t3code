import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

const UPSTREAM_PROFILE_NAMES = new Set(["t3code-v2", "t3code-dev", "t3code"]);
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// fork: an APPDATA profile name from T3CODE_DESKTOP_USER_DATA_NAME, so a fork runs beside the installed app.
export const forkUserDataName = Effect.gen(function* () {
  const name = (yield* HostProcess.Environment).T3CODE_DESKTOP_USER_DATA_NAME?.trim() ?? "";
  return PROFILE_NAME.test(name) && !UPSTREAM_PROFILE_NAMES.has(name.toLowerCase())
    ? name
    : undefined;
});
