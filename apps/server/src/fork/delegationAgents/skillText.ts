import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ForkAgentError } from "./agentFile.ts";

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Skill roots in search order, from the home folder. */
export const skillRoots = (path: Path.Path, home: string): ReadonlyArray<string> => [
  path.join(home, ".claude", "skills"),
  path.join(home, ".agents", "skills"),
  path.join(home, ".gemini", "config", "skills"),
];

export const readSkillText = Effect.fn("fork.readSkillText")(function* (input: {
  readonly name: string;
  readonly roots: ReadonlyArray<string>;
}) {
  if (input.name === "" || /[\\/]|\.\./.test(input.name)) {
    return yield* new ForkAgentError({ detail: `Skill name ${input.name} is invalid.` });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = input.roots.map((root) => path.join(root, input.name, "SKILL.md"));
  const found = yield* Effect.findFirst(files, (file) =>
    fs.exists(file).pipe(Effect.orElseSucceed(() => false)),
  );
  if (Option.isNone(found)) {
    return yield* new ForkAgentError({
      detail: `Skill ${input.name} is not in ${input.roots.join(", ")}.`,
    });
  }
  const text = yield* fs
    .readFileString(found.value)
    .pipe(
      Effect.mapError(
        () => new ForkAgentError({ detail: `Skill file ${found.value} cannot be read.` }),
      ),
    );
  return text.replace(FRONTMATTER, "").trim();
});
