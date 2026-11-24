import { describe, expect, it } from "vite-plus/test";

import {
  parseSafeHttpExternalUrl,
  resolveDesktopLinkContextMenuEntry,
} from "./linkContextMenu.logic.ts";

describe("linkContextMenu.logic", () => {
  describe("parseSafeHttpExternalUrl", () => {
    it.each([
      "http://localhost:3000/app",
      "https://example.com/docs?q=1#top",
      "HTTPS://EXAMPLE.COM/path",
    ])("allows %s", (url) => {
      expect(parseSafeHttpExternalUrl(url)).toBe(new URL(url).href);
    });

    it.each([
      "",
      "   ",
      "not a url",
      "mailto:owner@example.com",
      "file:///C:/Users/owner/index.html",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vscode://file/C:/repo/app.ts",
      "vscode-remote://ssh-remote+box/repo",
      "https://example.com/bad\nurl",
      null,
      undefined,
    ])("rejects %s", (url) => {
      expect(parseSafeHttpExternalUrl(url)).toBeNull();
    });
  });

  describe("resolveDesktopLinkContextMenuEntry", () => {
    it("offers Open in T3 when Open links in is system", () => {
      expect(
        resolveDesktopLinkContextMenuEntry({
          url: "https://example.com/docs",
          setting: "system",
        }),
      ).toEqual({
        action: "app",
        label: "Open in T3",
        url: "https://example.com/docs",
      });
    });

    it("offers Open externally when Open links in is app", () => {
      expect(
        resolveDesktopLinkContextMenuEntry({
          url: "https://example.com/docs",
          setting: "app",
        }),
      ).toEqual({
        action: "external",
        label: "Open externally",
        url: "https://example.com/docs",
      });
    });

    it("returns null for mailto and non-http schemes", () => {
      expect(
        resolveDesktopLinkContextMenuEntry({
          url: "mailto:owner@example.com",
          setting: "system",
        }),
      ).toBeNull();
      expect(
        resolveDesktopLinkContextMenuEntry({
          url: "mailto:owner@example.com",
          setting: "app",
        }),
      ).toBeNull();
      expect(
        resolveDesktopLinkContextMenuEntry({
          url: "file:///C:/secret.txt",
          setting: "app",
        }),
      ).toBeNull();
      expect(
        resolveDesktopLinkContextMenuEntry({
          url: "javascript:alert(1)",
          setting: "system",
        }),
      ).toBeNull();
    });
  });
});
