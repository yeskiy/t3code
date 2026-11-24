import { describe, expect, it, vi } from "vite-plus/test";

import {
  externalLinkContextMenuItems,
  resolveExternalWebLinkHref,
  showExternalLinkContextMenu,
} from "./externalLinkContextMenu";

describe("external chat link context menu", () => {
  it.each([
    [
      "https://example.com/docs?topic=security#links",
      "https://example.com/docs?topic=security#links",
    ],
    ["HTTP://EXAMPLE.COM", "http://example.com/"],
    ["//example.com/path", "https://example.com/path"],
  ])("resolves the safe external web-link href for %s as %s", (href, expected) => {
    expect(resolveExternalWebLinkHref(href)).toBe(expected);
  });

  it.each([
    "javascript:alert(document.domain)",
    " \nJaVaScRiPt:alert(document.domain)",
    "data:text/html,<script>alert(document.domain)</script>",
    "file:///tmp/example.txt",
    "mailto:hello@example.com",
    "/relative/path",
    "not a URL",
    "",
  ])("rejects unsafe external web-link href %s", (href) => {
    expect(resolveExternalWebLinkHref(href)).toBeNull();
  });

  it("shows only Open in T3 when the fork alternate entry is app", () => {
    const items = externalLinkContextMenuItems({
      href: "https://example.com/docs",
      canOpenInPreview: true,
      forkOpenEntry: { action: "app", label: "Open in T3" },
      threadLinkAction: "link-to-thread",
    });

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["link-to-thread", "Link to thread"],
      ["open-in-preview", "Open in T3"],
      ["copy-link", "Copy Link"],
    ]);
  });

  it("shows only Open externally when the fork alternate entry is external", () => {
    const items = externalLinkContextMenuItems({
      href: "https://example.com/docs",
      canOpenInPreview: true,
      forkOpenEntry: { action: "external", label: "Open externally" },
    });

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["open-external", "Open externally"],
      ["copy-link", "Copy Link"],
    ]);
  });

  it("does not forward unsafe URLs to openExternal", async () => {
    const openExternal = vi.fn(async () => {});
    await showExternalLinkContextMenu({
      href: "javascript:alert(1)",
      position: { x: 1, y: 1 },
      canOpenInPreview: false,
      showContextMenu: async () => "open-external",
      openInPreview: async () => {},
      openExternal,
      copyLink: async () => {},
      reportFailure: () => {},
    });

    expect(openExternal).not.toHaveBeenCalled();
  });
});
