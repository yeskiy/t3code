import { FORK_AGENT_LIMITS, ForkAgentLimit, ForkAgentName } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0, {
    expected: "a non-blank string",
  }),
);

export class ForkAgentError extends Schema.TaggedError<ForkAgentError>()("ForkAgentError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const AgentFrontmatter = Schema.Struct({
  name: ForkAgentName,
  description: Schema.String,
  provider: Schema.optional(NonBlankString),
  roles: Schema.optional(Schema.Array(Schema.String)),
  limits: Schema.optional(Schema.Array(ForkAgentLimit)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  defaults: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        model: Schema.optional(Schema.String),
        effort: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const decodeAgentFrontmatter = Schema.decodeUnknownEffect(AgentFrontmatter);

export interface ForkAgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly provider?: string | undefined;
  readonly roles: ReadonlyArray<string>;
  readonly limits: ReadonlyArray<ForkAgentLimit>;
  readonly skills: ReadonlyArray<string>;
  readonly defaults: Readonly<
    Record<string, { readonly model?: string | undefined; readonly effort?: string | undefined }>
  >;
  readonly body: string;
  readonly path: string;
}

export const parseAgentFile = Effect.fn("fork.parseAgentFile")(function* (input: {
  readonly path: string;
  readonly text: string;
}) {
  const fail = (reason: string) =>
    new ForkAgentError({ detail: `Agent file ${input.path} ${reason}.` });
  const match = FRONTMATTER.exec(input.text);
  if (match === null) return yield* fail("has no frontmatter");
  const raw = yield* Effect.try({
    try: () => parseYaml(match[1] ?? "") as unknown,
    catch: () => fail("has invalid YAML"),
  });
  const front = yield* decodeAgentFrontmatter(raw, {
    reportInput: true,
  }).pipe(
    Effect.mapError((error) =>
      fail(
        `has invalid frontmatter (${error.message}; limits are ${FORK_AGENT_LIMITS.join(", ")})`,
      ),
    ),
  );
  const fileName = input.path.split(/[\\/]/).at(-1) ?? "";
  if (fileName !== `${front.name}.md`) return yield* fail(`must be named ${front.name}.md`);
  return {
    name: front.name,
    description: front.description,
    ...(front.provider === undefined ? {} : { provider: front.provider.trim() }),
    roles: front.roles ?? [],
    limits: front.limits ?? [],
    skills: front.skills ?? [],
    defaults: front.defaults ?? {},
    body: (match[2] ?? "").trim(),
    path: input.path,
  } satisfies ForkAgentDefinition;
});
