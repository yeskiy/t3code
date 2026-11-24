import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { parseAgentFile } from "./agentFile.ts";

const file = `---
name: researcher
description: Read-only research.
roles: [research, review]
limits: [read-only, no-delegation]
skills: [ste-base]
defaults:
  claudeAgent: { model: claude-opus-5-5, effort: medium }
---

You are a read-only research agent.
`;

describe("parseAgentFile", () => {
  it.effect("reads the frontmatter and the body", () =>
    Effect.gen(function* () {
      const agent = yield* parseAgentFile({ path: "C:/a/researcher.md", text: file });
      expect(agent).toMatchObject({
        name: "researcher",
        description: "Read-only research.",
        roles: ["research", "review"],
        limits: ["read-only", "no-delegation"],
        skills: ["ste-base"],
        defaults: { claudeAgent: { model: "claude-opus-5-5", effort: "medium" } },
        body: "You are a read-only research agent.",
        path: "C:/a/researcher.md",
      });
    }),
  );

  it.effect("defaults omitted optional frontmatter lists and maps to empty", () =>
    Effect.gen(function* () {
      const minimal = `---\nname: worker\ndescription: General worker.\n---\n\nDo the work.\n`;
      const agent = yield* parseAgentFile({ path: "C:/a/worker.md", text: minimal });
      expect(agent).toEqual({
        name: "worker",
        description: "General worker.",
        roles: [],
        limits: [],
        skills: [],
        defaults: {},
        body: "Do the work.",
        path: "C:/a/worker.md",
      });
      expect(agent.provider).toBeUndefined();
    }),
  );

  it.effect("reads and trims an optional provider instance id", () =>
    Effect.gen(function* () {
      const withProvider = `---\nname: content\ndescription: Content writer.\nprovider: "  antigravity  "\n---\n\nWrite content.\n`;
      const agent = yield* parseAgentFile({ path: "C:/a/content.md", text: withProvider });
      expect(agent.provider).toBe("antigravity");
    }),
  );

  it.effect("fails when provider is empty or blank", () =>
    Effect.gen(function* () {
      const emptyError = yield* Effect.flip(
        parseAgentFile({
          path: "C:/a/content.md",
          text: `---\nname: content\ndescription: Content writer.\nprovider: ""\n---\n\nWrite.\n`,
        }),
      );
      expect(emptyError.message).toContain("provider");
      expect(emptyError.message).toContain('""');

      const blankError = yield* Effect.flip(
        parseAgentFile({
          path: "C:/a/content.md",
          text: `---\nname: content\ndescription: Content writer.\nprovider: "   "\n---\n\nWrite.\n`,
        }),
      );
      expect(blankError.message).toContain("provider");
      expect(blankError.message).toContain('"   "');

      const badTypeError = yield* Effect.flip(
        parseAgentFile({
          path: "C:/a/content.md",
          text: `---\nname: content\ndescription: Content writer.\nprovider: 42\n---\n\nWrite.\n`,
        }),
      );
      expect(badTypeError.message).toContain("provider");
      expect(badTypeError.message).toContain("42");
    }),
  );

  it.effect("fails when the name does not match the file name", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseAgentFile({ path: "C:/a/other.md", text: file }));
      expect(error.message).toContain("other.md");
      expect(error.message).toContain("researcher.md");
    }),
  );

  it.effect("fails on an unknown limit", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseAgentFile({
          path: "C:/a/researcher.md",
          text: file.replace("read-only", "no-network"),
        }),
      );
      expect(error.message).toContain("no-network");
    }),
  );

  it.effect("fails when frontmatter is missing", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseAgentFile({ path: "C:/a/researcher.md", text: "Just plain text.\n" }),
      );
      expect(error.message).toContain("has no frontmatter");
    }),
  );

  it.effect("fails when frontmatter YAML is invalid", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseAgentFile({
          path: "C:/a/researcher.md",
          text: "---\nname: [unterminated\n---\n\nBody\n",
        }),
      );
      expect(error.message).toContain("has invalid YAML");
    }),
  );
});
