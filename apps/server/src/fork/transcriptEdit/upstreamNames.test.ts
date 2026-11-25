import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../../../../..");

const UPSTREAM_NAMES: ReadonlyArray<{
  readonly file: string;
  readonly names: ReadonlyArray<string>;
}> = [
  {
    file: "apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts",
    names: [
      ":thinking:",
      "nativeConversationHeadRef",
      "locateClaudeTranscript",
      "isSyntheticClaudeTurnId",
      "promptStarted",
      "steerUuids",
    ],
  },
  {
    file: "apps/server/src/orchestration-v2/TurnItemPositionStore.ts",
    names: ["1_000_000"],
  },
  {
    file: "apps/server/src/orchestration-v2/CheckpointRollbackService.ts",
    names: ["rollbackFailureClientMessage", "ROLLBACK_FAILED_MESSAGE"],
  },
  {
    file: "apps/web/src/components/chat/MessagesTimeline.tsx",
    names: ["alwaysRenderKeys", "TimelineRowContent row={row}"],
  },
  {
    file: "packages/shared/src/keybindings.ts",
    names: ['"thread.undo"', "orderForkToolCallKeybindings"],
  },
];

describe("transcript edit upstream names", () => {
  it.each(UPSTREAM_NAMES)("keeps required symbols in $file", ({ file, names }) => {
    const text = NodeFS.readFileSync(NodePath.join(REPO_ROOT, file), "utf8");
    const missing = names.filter((name) => !text.includes(name));
    expect(missing).toEqual([]);
  });
});
