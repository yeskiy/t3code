import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  composerStopLabel,
  decideComposerStop,
  formatStopBackgroundConfirmDescription,
} from "./composerStop.logic";

describe("decideComposerStop", () => {
  it("returns stop-turn when a turn is running with no background work", () => {
    expect(decideComposerStop({ turnRunning: true, backgroundCount: 0 })).toBe("stop-turn");
  });

  it("returns stop-turn when both a turn and background work are running", () => {
    expect(decideComposerStop({ turnRunning: true, backgroundCount: 2 })).toBe("stop-turn");
  });

  it("returns confirm-stop-all when no turn is running and background work exists", () => {
    expect(decideComposerStop({ turnRunning: false, backgroundCount: 1 })).toBe("confirm-stop-all");
    expect(decideComposerStop({ turnRunning: false, backgroundCount: 4 })).toBe("confirm-stop-all");
  });

  it("returns none when neither a turn nor background work is running", () => {
    expect(decideComposerStop({ turnRunning: false, backgroundCount: 0 })).toBe("none");
    expect(decideComposerStop({ turnRunning: false, backgroundCount: -1 })).toBe("none");
  });
});

describe("composerStopLabel", () => {
  it("returns Stop turn when only a turn is running", () => {
    expect(composerStopLabel({ turnRunning: true, backgroundCount: 0 })).toBe("Stop turn");
  });

  it("returns Stop turn (background work keeps running) when both exist", () => {
    expect(composerStopLabel({ turnRunning: true, backgroundCount: 1 })).toBe(
      "Stop turn (background work keeps running)",
    );
  });

  it("returns Stop background work when only background work runs", () => {
    expect(composerStopLabel({ turnRunning: false, backgroundCount: 2 })).toBe(
      "Stop background work",
    );
  });

  it("returns undefined when neither a turn nor background work runs", () => {
    expect(composerStopLabel({ turnRunning: false, backgroundCount: 0 })).toBeUndefined();
  });
});

describe("formatStopBackgroundConfirmDescription", () => {
  it("describes a single running command", () => {
    const tasks: OrchestrationV2PendingBackgroundTask[] = [{ taskId: "cmd-1", kind: "command" }];
    expect(formatStopBackgroundConfirmDescription(tasks)).toBe(
      "1 command is running in the background. All background work will stop.",
    );
  });

  it("describes multiple commands", () => {
    const tasks: OrchestrationV2PendingBackgroundTask[] = [
      { taskId: "cmd-1", kind: "command" },
      { taskId: "cmd-2", kind: "command" },
    ];
    expect(formatStopBackgroundConfirmDescription(tasks)).toBe(
      "2 commands are running in the background. All background work will stop.",
    );
  });

  it("distinguishes native subagents from app-owned delegated tasks", () => {
    const tasks: OrchestrationV2PendingBackgroundTask[] = [
      { taskId: "cmd-1", kind: "command" },
      { taskId: "native-1", kind: "subagent" },
      { taskId: "native-2", kind: "subagent" },
      { taskId: "delegated-1", kind: "subagent" },
    ];
    const turnItems = [
      { id: "native-1", type: "subagent" as const, origin: "provider_native" as const },
      { id: "delegated-1", type: "subagent" as const, origin: "app_owned" as const },
    ];
    expect(formatStopBackgroundConfirmDescription(tasks, turnItems)).toBe(
      "1 command, 2 subagents, and 1 delegated task are running in the background. All background work will stop.",
    );
  });

  it("names pull request watches, monitors, and generic background tasks", () => {
    const tasks: OrchestrationV2PendingBackgroundTask[] = [
      { taskId: "pull-request-watch:github.com/org/repo#42", kind: "monitor" },
      { taskId: "mon-1", kind: "monitor" },
      { taskId: "bg-1", kind: "background_task" },
    ];
    expect(formatStopBackgroundConfirmDescription(tasks)).toBe(
      "1 monitor, 1 pull request watch, and 1 background task are running in the background. All background work will stop.",
    );
  });

  it("falls back when no tasks are provided", () => {
    expect(formatStopBackgroundConfirmDescription([])).toBe(
      "Background work is running. All background work will stop.",
    );
  });
});
