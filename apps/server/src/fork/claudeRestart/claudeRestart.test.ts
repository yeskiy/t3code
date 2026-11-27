import { assert, describe, it } from "@effect/vitest";
import { claudeRestartBlockedMessage } from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ClaudeAdapterV2 from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import {
  claudeRestartBlockingItems,
  claudeRestartReason,
  claudeWorkspaceUpdate,
} from "./claudeRestart.ts";

const queryPolicy = ClaudeAdapterV2.claudeRuntimeQueryPolicyForRuntimePolicy(
  ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
    runtimeMode: "approval-required",
    interactionMode: "default",
    cwd: "/workspace",
  }),
);
const folders = [
  { name: "api", path: "/workspace/api", isGitRepository: true },
  { name: "web", path: "/workspace/web", isGitRepository: true },
];
const keyFor = (
  workspace?: ProviderAdapter.ProviderAdapterV2RuntimeWorkspace,
  mcpServers?: Record<string, never>,
) =>
  ClaudeAdapterV2.claudeEffectiveQueryPolicyKey(
    queryPolicy,
    mcpServers === undefined ? {} : { mcpServers },
    workspace,
  );

describe("fork Claude restart", () => {
  it("keeps the query key for folders inside cwd and changes it for a new extra root", () => {
    assert.equal(keyFor({ folders, extraRoots: [] }), keyFor());
    assert.equal(keyFor({ folders: folders.slice(0, 1), extraRoots: [] }), keyFor());
    assert.notEqual(keyFor({ folders, extraRoots: ["/repos/shared"] }), keyFor());
    assert.equal(
      keyFor({ folders, extraRoots: ["/b", "/a"] }),
      keyFor({ folders, extraRoots: ["/a", "/b"] }),
    );
  });

  it("names the part of the key that changed", () => {
    const base = keyFor();
    const reason = (nextKey: string, sameSession = true) =>
      claudeRestartReason({ sameSession, previousKey: base, nextKey });
    assert.equal(reason(base), "model");
    assert.equal(reason(keyFor({ folders, extraRoots: ["/repos/shared"] })), "workspace");
    assert.equal(reason(keyFor(undefined, {})), "mcp");
    assert.equal(
      reason(
        ClaudeAdapterV2.claudeEffectiveQueryPolicyKey(
          ClaudeAdapterV2.claudeRuntimeQueryPolicyForRuntimePolicy(
            ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: "/workspace",
            }),
          ),
          {},
        ),
      ),
      "permissions",
    );
    assert.equal(reason(base, false), "other");
  });

  it("lists roster commands and running subagents as blockers", () => {
    const items = claudeRestartBlockingItems({
      roster: [
        { taskId: "b1", kind: "command", description: "Start the preview server" },
        { taskId: "b2", kind: "command", command: "npx vite preview --port 5318" },
      ],
      subagents: [{ taskId: "a1", title: null, prompt: "Research the bug" }],
    });
    assert.deepEqual(items, [
      { taskId: "b1", kind: "command", description: "Start the preview server" },
      { taskId: "b2", kind: "command", description: "npx vite preview --port 5318" },
      { taskId: "a1", kind: "agent", description: "Research the bug" },
    ]);
    assert.equal(
      claudeRestartBlockedMessage("model", items.slice(1, 2)),
      "Claude must restart because the model or its settings changed. These background tasks would end: npx vite preview --port 5318 (command). Wait for them to finish, or stop them, then send the message again.",
    );
  });

  it("adds the folder list once when it changes, and not for a slash command", () => {
    const addContext = (message: string, entry: { readonly key: string; readonly text: string }) =>
      message.startsWith("/") ? message : `<${entry.key}>${entry.text}|${message}`;
    const policy = { cwd: "/workspace", workspace: { folders, extraRoots: [] } };
    const first = claudeWorkspaceUpdate({
      known: "",
      policy,
      message: "hello",
      skip: false,
      addContext,
    });
    assert.include(first.message, "/workspace/web");
    assert.notEqual(first.known, "");
    const again = claudeWorkspaceUpdate({
      known: first.known,
      policy,
      message: "next",
      skip: false,
      addContext,
    });
    assert.equal(again.message, "next");
    const slash = claudeWorkspaceUpdate({
      known: "",
      policy,
      message: "/compact",
      skip: false,
      addContext,
    });
    assert.deepEqual(slash, { message: "/compact", known: "" });
    const removed = claudeWorkspaceUpdate({
      known: first.known,
      policy: { cwd: "/workspace" },
      message: "bye",
      skip: false,
      addContext,
    });
    assert.include(removed.message, "no longer spans several folders");
    assert.equal(removed.known, "");
  });
});
