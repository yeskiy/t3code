import { describe, expect, it } from "vite-plus/test";

import { isBlockedWindowsExecutable, validateLocalOpenPath } from "./openPath.logic.ts";

describe("validateLocalOpenPath", () => {
  it.each([
    { rawPath: "C:\\Users\\owner\\report.pdf", platform: "win32" as const },
    { rawPath: "E:/Projects/demo/index.html", platform: "win32" as const },
    { rawPath: "D:\\folder with spaces\\image.png", platform: "win32" as const },
    { rawPath: "/Users/owner/report.pdf", platform: "darwin" as const },
    { rawPath: "/home/owner/index.html", platform: "linux" as const },
  ])("accepts valid local path $rawPath on $platform", ({ rawPath, platform }) => {
    expect(validateLocalOpenPath(rawPath, platform)).toEqual({ ok: true, path: rawPath });
  });

  it.each([
    "",
    "   ",
    "relative/file.html",
    "./index.html",
    "../secret.txt",
    "file:///C:/Users/owner/index.html",
    "file:///etc/passwd",
    "http://example.com",
    "https://example.com/page.html",
    "mailto:test@example.com",
    "javascript:alert(1)",
    "ms-msdt:/id",
    "\\\\server\\share\\file.pdf",
    "//server/share/file.pdf",
    "\\\\?\\C:\\Windows\\notepad.exe",
    "\\\\.\\COM1",
    "C:\\Users\\owner\\bad\0file.txt",
    "C:\\Users\\owner\\bad\nfile.txt",
  ])("rejects unsafe or non-local path %s on win32", (rawPath) => {
    const result = validateLocalOpenPath(rawPath, "win32");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-path");
    }
  });

  it.each([
    "C:\\Tools\\setup.exe",
    "C:\\Tools\\run.BAT",
    "C:\\Tools\\script.cmd",
    "C:\\Tools\\install.msi",
    "C:\\Tools\\deploy.ps1",
    "C:\\Tools\\macro.vbs",
    "C:\\Tools\\shortcut.lnk",
    "C:\\Tools\\link.url",
    "C:\\Tools\\app.hta",
    "C:\\Tools\\keys.reg",
    "C:\\Tools\\screen.scr",
    "C:\\Tools\\tool.jar",
    "C:\\Tools\\lib.dll",
  ])("blocks Windows executable path %s", (rawPath) => {
    expect(isBlockedWindowsExecutable(rawPath)).toBe(true);
    const result = validateLocalOpenPath(rawPath, "win32");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("blocked-executable");
    }
  });

  it.each([
    "C:\\Docs\\page.html",
    "C:\\Docs\\page.htm",
    "C:\\Docs\\book.pdf",
    "C:\\Docs\\photo.png",
    "C:\\Docs\\notes.md",
    "C:\\Docs\\app.ts",
    "C:\\Docs\\Makefile",
  ])("allows non-executable document path %s on win32", (rawPath) => {
    expect(isBlockedWindowsExecutable(rawPath)).toBe(false);
    expect(validateLocalOpenPath(rawPath, "win32").ok).toBe(true);
  });
});
