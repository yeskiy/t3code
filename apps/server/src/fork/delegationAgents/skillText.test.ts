import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { readSkillText } from "./skillText.ts";

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  const roots = [path.join(dir, "one"), path.join(dir, "two")];
  yield* fs.makeDirectory(path.join(roots[0]!, "ste-base"), { recursive: true });
  yield* fs.makeDirectory(path.join(roots[1]!, "ste-base"), { recursive: true });
  yield* fs.writeFileString(
    path.join(roots[0]!, "ste-base", "SKILL.md"),
    "---\nname: ste-base\n---\n\nFirst root text.\n",
  );
  yield* fs.writeFileString(path.join(roots[1]!, "ste-base", "SKILL.md"), "Second root text.\n");
  return roots;
});

describe("readSkillText", () => {
  it.effect("uses the first root and strips the frontmatter", () =>
    Effect.gen(function* () {
      const roots = yield* setup;
      expect(yield* readSkillText({ name: "ste-base", roots })).toBe("First root text.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("falls back to later roots when earlier roots do not have the skill", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const roots = yield* setup;
      yield* fs.makeDirectory(path.join(roots[1]!, "only-second"), { recursive: true });
      yield* fs.writeFileString(
        path.join(roots[1]!, "only-second", "SKILL.md"),
        "---\ndescription: Second\n---\nSecond only body.\n",
      );
      expect(yield* readSkillText({ name: "only-second", roots })).toBe("Second only body.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with every searched root when the skill is missing", () =>
    Effect.gen(function* () {
      const roots = yield* setup;
      const error = yield* Effect.flip(readSkillText({ name: "nope", roots }));
      expect(error.message).toContain(roots[0]);
      expect(error.message).toContain(roots[1]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
