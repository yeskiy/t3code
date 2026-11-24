import { describe, expect, it } from "vite-plus/test";

import {
  FORK_OPEN_FILES_IN_DEFAULT,
  FORK_OPEN_FILES_IN_KEY,
  FORK_OPEN_LINKS_IN_DEFAULT,
  FORK_OPEN_LINKS_IN_KEY,
  isMailtoUrl,
  isSafeExternalBrowserUrl,
  resolveForkFileAction,
  resolveForkLinkAction,
  resolveLocalFileAbsolutePath,
  shouldInterceptInAppLink,
} from "./externalOpen.logic";

describe("externalOpen.logic", () => {
  it("uses fork storage keys and defaults to external choices", () => {
    expect(FORK_OPEN_LINKS_IN_KEY).toBe("t3code:fork:open-links-in:v1");
    expect(FORK_OPEN_LINKS_IN_DEFAULT).toBe("system");
    expect(FORK_OPEN_FILES_IN_KEY).toBe("t3code:fork:open-files-in:v1");
    expect(FORK_OPEN_FILES_IN_DEFAULT).toBe("external");
  });

  describe("isSafeExternalBrowserUrl", () => {
    it.each([
      "http://localhost:3000/app",
      "https://example.com/docs?q=1#top",
      "mailto:owner@example.com",
      "MAILTO:owner@example.com?subject=Hello",
    ])("allows %s", (url) => {
      expect(isSafeExternalBrowserUrl(url)).toBe(true);
    });

    it.each([
      "",
      "not a url",
      "file:///C:/Users/owner/index.html",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "ms-msdt:/id",
      "https://example.com/bad\nurl",
      "mailto:owner@example.com\0",
    ])("rejects %s", (url) => {
      expect(isSafeExternalBrowserUrl(url)).toBe(false);
    });
  });

  describe("isMailtoUrl", () => {
    it("matches only valid mailto URLs", () => {
      expect(isMailtoUrl("mailto:owner@example.com")).toBe(true);
      expect(isMailtoUrl("https://example.com")).toBe(false);
      expect(isMailtoUrl("mailto:bad\n@example.com")).toBe(false);
    });
  });

  describe("resolveForkLinkAction", () => {
    const plain = { metaKey: false, ctrlKey: false, button: 0 };
    const ctrl = { metaKey: false, ctrlKey: true, button: 0 };

    it("opens web URLs in system browser when setting is system", () => {
      expect(
        resolveForkLinkAction({
          url: "https://example.com",
          setting: "system",
          event: plain,
          canOpenInApp: true,
        }),
      ).toBe("system");
    });

    it("opens web URLs in T3 browser when setting is app and no modifier is held", () => {
      expect(
        resolveForkLinkAction({
          url: "https://example.com",
          setting: "app",
          event: plain,
          canOpenInApp: true,
        }),
      ).toBe("app");
    });

    it("opens web URLs in system browser on Ctrl-click even when setting is app", () => {
      expect(
        resolveForkLinkAction({
          url: "https://example.com",
          setting: "app",
          event: ctrl,
          canOpenInApp: true,
        }),
      ).toBe("system");
    });

    it("always routes mailto URLs to the system handler", () => {
      expect(
        resolveForkLinkAction({
          url: "mailto:owner@example.com",
          setting: "app",
          event: plain,
          canOpenInApp: true,
        }),
      ).toBe("system");
    });

    it("rejects non-http(s)/mailto schemes", () => {
      expect(
        resolveForkLinkAction({
          url: "file:///C:/secret.txt",
          setting: "system",
          event: plain,
          canOpenInApp: true,
        }),
      ).toBe("reject");
      expect(
        resolveForkLinkAction({
          url: "javascript:alert(1)",
          setting: "app",
          event: plain,
          canOpenInApp: true,
        }),
      ).toBe("reject");
    });
  });

  describe("shouldInterceptInAppLink", () => {
    it("disables in-app PR, issue, and media link hijacking when setting is system", () => {
      expect(shouldInterceptInAppLink("system")).toBe(false);
      expect(shouldInterceptInAppLink("app")).toBe(true);
    });
  });

  describe("resolveForkFileAction", () => {
    it.each([
      { setting: "external" as const, canOpenLocally: true, altKey: false, expected: "external" },
      { setting: "external" as const, canOpenLocally: true, altKey: true, expected: "app" },
      { setting: "external" as const, canOpenLocally: false, altKey: false, expected: "app" },
      { setting: "app" as const, canOpenLocally: true, altKey: false, expected: "app" },
    ])(
      "setting=$setting local=$canOpenLocally alt=$altKey -> $expected",
      ({ setting, canOpenLocally, altKey, expected }) => {
        expect(resolveForkFileAction({ setting, canOpenLocally, altKey })).toBe(expected);
      },
    );
  });

  describe("resolveLocalFileAbsolutePath", () => {
    it("resolves workspace-relative paths against Windows and POSIX roots", () => {
      expect(
        resolveLocalFileAbsolutePath({ path: "docs/report.html", cwd: "E:\\Projects\\repo" }),
      ).toBe("E:\\Projects\\repo\\docs\\report.html");
      expect(resolveLocalFileAbsolutePath({ path: "src/app.ts:42:5", cwd: "/repo" })).toBe(
        "/repo/src/app.ts",
      );
      expect(
        resolveLocalFileAbsolutePath({ path: "C:\\Users\\me\\file.pdf#L10", cwd: undefined }),
      ).toBe("C:\\Users\\me\\file.pdf");
    });

    it.each([
      { path: "relative.txt", cwd: undefined },
      { path: "https://example.com/a.pdf", cwd: "E:\\Projects\\repo" },
      { path: "file:///C:/a.html", cwd: "E:\\Projects\\repo" },
      { path: "\\\\server\\share\\file.pdf", cwd: "E:\\Projects\\repo" },
      { path: "//server/share/file.pdf", cwd: "/repo" },
      { path: "\\\\?\\C:\\file.txt", cwd: "E:\\Projects\\repo" },
      { path: "C:\\bad\0path.txt", cwd: "E:\\Projects\\repo" },
    ])("rejects invalid path $path", ({ path, cwd }) => {
      expect(resolveLocalFileAbsolutePath({ path, cwd })).toBeNull();
    });
  });
});
