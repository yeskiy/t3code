import { ForkTranscriptEditError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { refusalActionLabel, refusalView, saveToast } from "./saveRefusal.logic";

const refusal = (code: ForkTranscriptEditError["code"], detail: string) =>
  refusalView(new ForkTranscriptEditError({ code, detail }));

describe("refusalView", () => {
  it("offers Stop and save for busy and shows the server reason", () => {
    const view = refusal("busy", "The thread is working now. Confirm the stop to save.");
    expect(view.title).toBe("The thread is working now");
    expect(view.body).toBe("The thread is working now. Confirm the stop to save.");
    expect(view.actions).toEqual(["confirmStop", "dismiss"]);
  });

  it("only dismisses a stopFailed refusal", () => {
    const view = refusal("stopFailed", "The thread did not stop in 20 seconds.");
    expect(view.title).toBe("The turn did not stop");
    expect(view.body).toBe("The thread did not stop in 20 seconds.");
    expect(view.actions).toEqual(["dismiss"]);
  });

  it("offers both reloads for stale", () => {
    const view = refusal("stale", "The session file changed after it was loaded.");
    expect(view.title).toBe("The session changed after you started editing");
    expect(view.body).toBe("The session file changed after it was loaded.");
    expect(view.actions).toEqual(["reload", "reloadKeep", "dismiss"]);
  });

  it("shows the validation messages for invalid", () => {
    const view = refusal("invalid", "Broken chain at u2. Tool result without call.");
    expect(view.title).toBe("The edited transcript is not valid");
    expect(view.body).toBe("Broken chain at u2. Tool result without call.");
    expect(view.actions).toEqual(["dismiss"]);
  });

  it("offers Reload and keep my changes for changed", () => {
    const view = refusal("changed", "Change 2 no longer applies: unit u3 is missing");
    expect(view.title).toBe("A change no longer applies to the session file");
    expect(view.body).toBe("Change 2 no longer applies: unit u3 is missing");
    expect(view.actions).toEqual(["reloadKeep", "dismiss"]);
  });

  it("keeps the backup name of a writeFailed refusal", () => {
    const view = refusal(
      "writeFailed",
      "The session file cannot be written. Backup 20261125T100200Z.jsonl holds it.",
    );
    expect(view.title).toBe("The save did not finish");
    expect(view.body).toContain("20261125T100200Z.jsonl");
    expect(view.actions).toEqual(["dismiss"]);
  });

  it.each([
    ["not-claude", "Transcript editing works for Claude threads only."],
    ["no-session-file", "No session file exists for session s1."],
    ["badBackup", "The backup cannot be read."],
  ] as const)("shows the detail of %s", (code, detail) => {
    const view = refusal(code, detail);
    expect(view.title).toBe("The transcript cannot be saved");
    expect(view.body).toBe(detail);
    expect(view.actions).toEqual(["dismiss"]);
  });
});

describe("refusalActionLabel", () => {
  it("names dismiss Close when it is the only action", () => {
    expect(refusalActionLabel("dismiss", ["dismiss"])).toBe("Close");
    expect(refusalActionLabel("dismiss", ["confirmStop", "dismiss"])).toBe("Cancel");
    expect(refusalActionLabel("confirmStop", ["confirmStop", "dismiss"])).toBe("Stop and save");
    expect(refusalActionLabel("reloadKeep", ["reloadKeep", "dismiss"])).toBe(
      "Reload and keep my changes",
    );
  });
});

describe("saveToast", () => {
  it("adds the inherited and unmapped counts only when they are not zero", () => {
    expect(saveToast({ inheritedUnits: 0, unmappedUnits: 0 })).toEqual({
      title: "Saved. Claude sees the edited history on the next message.",
      description: null,
    });
    expect(saveToast({ inheritedUnits: 2, unmappedUnits: 1 }).description).toBe(
      "2 messages from the parent thread kept their old text in the timeline. 1 change is not shown in the timeline.",
    );
  });
});
