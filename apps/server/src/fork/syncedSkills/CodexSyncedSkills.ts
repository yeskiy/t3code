import type * as CodexErrors from "effect-codex-app-server/errors";
import * as Effect from "effect/Effect";

export interface CodexExtraRootsClient {
  readonly request: (
    method: "skills/extraRoots/set",
    params: { readonly extraRoots: ReadonlyArray<string> },
  ) => Effect.Effect<unknown, CodexErrors.CodexAppServerError>;
}

/** Shares extra skill roots with a Codex app-server session, ignoring unsupported older CLIs. */
export const syncCodexExtraSkillRoots = Effect.fn("syncCodexExtraSkillRoots")(function* (
  client: CodexExtraRootsClient,
  extraSkillRoots: ReadonlyArray<string>,
): Effect.fn.Return<void> {
  if (extraSkillRoots.length === 0) {
    return;
  }
  yield* client.request("skills/extraRoots/set", { extraRoots: [...extraSkillRoots] }).pipe(
    Effect.asVoid,
    Effect.catch((error) =>
      Effect.logDebug("Codex skills/extraRoots/set was not applied.", { error }),
    ),
  );
});
