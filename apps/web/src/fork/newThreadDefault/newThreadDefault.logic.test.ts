import { describe, expect, it } from "vite-plus/test";

import { decideForkLanding } from "./newThreadDefault.logic";

describe("decideForkLanding", () => {
  it.each([
    { setting: "lastUsed", ready: true, env: "local", shiftKey: false, expected: "upstream" },
    { setting: "scratch", ready: true, env: "local", shiftKey: true, expected: "upstream" },
    { setting: "scratch", ready: true, env: "local", shiftKey: false, expected: "scratch" },
    { setting: "scratch", ready: false, env: "local", shiftKey: false, expected: "scratch" },
    { setting: "scratch", ready: false, env: null, shiftKey: false, expected: "wait" },
    { setting: "scratch", ready: true, env: null, shiftKey: false, expected: "upstream" },
  ] as const)("$setting ready=$ready env=$env shift=$shiftKey -> $expected", (row) => {
    expect(
      decideForkLanding({
        setting: row.setting,
        environmentsReady: row.ready,
        scratchEnvironmentId: row.env,
        shiftKey: row.shiftKey,
      }),
    ).toBe(row.expected);
  });
});
