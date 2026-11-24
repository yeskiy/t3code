import { ClientSettingsSchema } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
} from "~/components/chat/threadDetailsItems";

import { filterForkThreadDetailsItems, FORK_THREAD_DETAILS_ITEMS } from "./forkThreadDetailsItems";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("forkThreadDetailsItems", () => {
  it("registers Artifacts as a default-visible thread details item", () => {
    expect(FORK_THREAD_DETAILS_ITEMS).toEqual([
      { id: "artifacts", label: "Artifacts", defaultVisible: true },
    ]);
    expect(THREAD_DETAILS_ITEMS.some((item) => item.id === "artifacts")).toBe(true);
  });

  it("resolves missing artifacts as visible and respects false override", () => {
    const defaultVisibility = resolveThreadDetailsVisibility({
      threadDetailsItems: {},
      threadDetailsUsageEnabled: false,
    });
    expect(defaultVisibility.artifacts).toBe(true);

    const hiddenVisibility = resolveThreadDetailsVisibility({
      threadDetailsItems: { artifacts: false },
      threadDetailsUsageEnabled: false,
    });
    expect(hiddenVisibility.artifacts).toBe(false);
  });

  it("stores only non-default overrides for artifacts", () => {
    const artifacts = THREAD_DETAILS_ITEMS.find((item) => item.id === "artifacts")!;
    const empty = { threadDetailsItems: {}, threadDetailsUsageEnabled: false };

    expect(setThreadDetailsItem(empty, artifacts, false)).toEqual({ artifacts: false });
    expect(
      setThreadDetailsItem(
        { threadDetailsItems: { artifacts: false }, threadDetailsUsageEnabled: false },
        artifacts,
        true,
      ),
    ).toEqual({});
  });

  it("hides the artifacts choice when Show renders as artifacts is off", () => {
    const enabledItems = filterForkThreadDetailsItems(THREAD_DETAILS_ITEMS, true);
    const disabledItems = filterForkThreadDetailsItems(THREAD_DETAILS_ITEMS, false);

    expect(enabledItems.some((item) => item.id === "artifacts")).toBe(true);
    expect(disabledItems.some((item) => item.id === "artifacts")).toBe(false);
    expect(disabledItems.length).toBe(enabledItems.length - 1);

    const hiddenArtifactsVisibility = resolveThreadDetailsVisibility({
      threadDetailsItems: { artifacts: false },
      threadDetailsUsageEnabled: false,
    });
    expect(isDefaultThreadDetailsVisibility(hiddenArtifactsVisibility, enabledItems)).toBe(false);
    expect(isDefaultThreadDetailsVisibility(hiddenArtifactsVisibility, disabledItems)).toBe(true);
  });

  it("decodes stored ClientSettings with missing or false artifacts", () => {
    const olderSettings = decodeClientSettings({});
    expect(olderSettings.threadDetailsItems).toEqual({});
    expect(resolveThreadDetailsVisibility(olderSettings).artifacts).toBe(true);

    const storedHidden = decodeClientSettings({
      threadDetailsItems: { artifacts: false, unknownFutureItem: true },
    });
    expect(storedHidden.threadDetailsItems).toEqual({
      artifacts: false,
      unknownFutureItem: true,
    });
    expect(resolveThreadDetailsVisibility(storedHidden).artifacts).toBe(false);
  });
});
