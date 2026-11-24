import { assert, it } from "@effect/vitest";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as Effect from "effect/Effect";

import { syncCodexExtraSkillRoots } from "./CodexSyncedSkills.ts";

it.effect("sends skills/extraRoots/set when extra skill roots are present", () =>
  Effect.gen(function* () {
    const calls: Array<{ readonly method: string; readonly params: unknown }> = [];
    const client = {
      request: (
        method: "skills/extraRoots/set",
        params: { readonly extraRoots: ReadonlyArray<string> },
      ) => {
        calls.push({ method, params });
        return Effect.succeed({});
      },
    };

    yield* syncCodexExtraSkillRoots(client, []);
    assert.deepEqual(calls, []);

    yield* syncCodexExtraSkillRoots(client, ["C:\\claude\\skills\\synced\\bucket"]);
    assert.deepEqual(calls, [
      {
        method: "skills/extraRoots/set",
        params: { extraRoots: ["C:\\claude\\skills\\synced\\bucket"] },
      },
    ]);
  }),
);

it.effect("ignores errors when an older Codex app-server rejects skills/extraRoots/set", () =>
  Effect.gen(function* () {
    const client = {
      request: () =>
        Effect.fail(
          new CodexErrors.CodexAppServerRequestError({
            method: "skills/extraRoots/set",
            code: -32601,
            errorMessage: "Method not found",
          }),
        ),
    };

    yield* syncCodexExtraSkillRoots(client, ["/claude/skills/synced/bucket"]);
  }),
);
