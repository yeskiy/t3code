const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const UNC_OR_DEVICE_PATH_PATTERN = /^[/\\]{2}/;

const BLOCKED_WINDOWS_EXECUTABLE_EXTENSIONS = new Set([
  ".appref-ms",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".exe",
  ".hta",
  ".inf",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".msc",
  ".msi",
  ".msp",
  ".msu",
  ".ocx",
  ".pif",
  ".ps1",
  ".psd1",
  ".psm1",
  ".reg",
  ".scr",
  ".sys",
  ".url",
  ".vbe",
  ".vbs",
  ".wsf",
  ".wsh",
]);

export type LocalOpenPathValidationResult =
  | { readonly ok: true; readonly path: string }
  | {
      readonly ok: false;
      readonly reason: "invalid-path" | "blocked-executable";
      readonly error: string;
    };

export function isBlockedWindowsExecutable(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  const fileName = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return false;
  return BLOCKED_WINDOWS_EXECUTABLE_EXTENSIONS.has(fileName.slice(lastDot).toLowerCase());
}

export function validateLocalOpenPath(
  rawPath: string,
  platform: NodeJS.Platform,
): LocalOpenPathValidationResult {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return { ok: false, reason: "invalid-path", error: "File path is empty." };
  }
  if (CONTROL_CHAR_PATTERN.test(rawPath)) {
    return { ok: false, reason: "invalid-path", error: "File path contains invalid characters." };
  }
  if (UNC_OR_DEVICE_PATH_PATTERN.test(rawPath)) {
    return {
      ok: false,
      reason: "invalid-path",
      error: "Network and device paths cannot be opened directly.",
    };
  }
  const isWindowsDrivePath = WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(rawPath);
  if (!isWindowsDrivePath && URI_SCHEME_PATTERN.test(rawPath)) {
    return {
      ok: false,
      reason: "invalid-path",
      error: "URLs cannot be opened as local file paths.",
    };
  }
  const isAbsolute = platform === "win32" ? isWindowsDrivePath : rawPath.startsWith("/");
  if (!isAbsolute) {
    return {
      ok: false,
      reason: "invalid-path",
      error: "Only absolute local file paths can be opened.",
    };
  }
  if (platform === "win32" && isBlockedWindowsExecutable(rawPath)) {
    return {
      ok: false,
      reason: "blocked-executable",
      error: "Executable and script files are not opened directly for safety.",
    };
  }
  return { ok: true, path: rawPath };
}
