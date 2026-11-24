import type { BrowserLinkTarget } from "@t3tools/contracts";

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

export type DesktopLinkContextMenuEntry =
  | { readonly action: "app"; readonly label: "Open in T3"; readonly url: string }
  | { readonly action: "external"; readonly label: "Open externally"; readonly url: string };

export function parseSafeHttpExternalUrl(rawUrl: unknown): string | null {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.trim().length === 0 ||
    CONTROL_CHAR_PATTERN.test(rawUrl)
  ) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function resolveDesktopLinkContextMenuEntry(input: {
  readonly url: unknown;
  readonly setting: BrowserLinkTarget;
}): DesktopLinkContextMenuEntry | null {
  const safeUrl = parseSafeHttpExternalUrl(input.url);
  if (safeUrl === null) return null;
  return input.setting === "app"
    ? { action: "external", label: "Open externally", url: safeUrl }
    : { action: "app", label: "Open in T3", url: safeUrl };
}
