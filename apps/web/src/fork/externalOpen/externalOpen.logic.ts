/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { resolvePathLinkTarget, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { isAbsolutePath } from "@t3tools/shared/path";
import * as Schema from "effect/Schema";

export const FORK_OPEN_LINKS_IN_KEY = "t3code:fork:open-links-in:v1";
export const ForkOpenLinksIn = Schema.Literals(["system", "app"]);
export type ForkOpenLinksIn = typeof ForkOpenLinksIn.Type;
export const FORK_OPEN_LINKS_IN_DEFAULT: ForkOpenLinksIn = "system";

export const FORK_OPEN_FILES_IN_KEY = "t3code:fork:open-files-in:v1";
export const ForkOpenFilesIn = Schema.Literals(["external", "app"]);
export type ForkOpenFilesIn = typeof ForkOpenFilesIn.Type;
export const FORK_OPEN_FILES_IN_DEFAULT: ForkOpenFilesIn = "external";

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const UNC_OR_DEVICE_PATH_PATTERN = /^[/\\]{2}/;
const SAFE_EXTERNAL_BROWSER_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeExternalBrowserUrl(rawUrl: string): boolean {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.trim().length === 0 ||
    CONTROL_CHAR_PATTERN.test(rawUrl)
  ) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return SAFE_EXTERNAL_BROWSER_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function isMailtoUrl(rawUrl: string): boolean {
  if (!isSafeExternalBrowserUrl(rawUrl)) return false;
  try {
    return new URL(rawUrl).protocol === "mailto:";
  } catch {
    return false;
  }
}

export function isSafeHttpBrowserUrl(rawUrl: string): boolean {
  return isSafeExternalBrowserUrl(rawUrl) && !isMailtoUrl(rawUrl);
}

export type ForkAlternateOpenMenuEntry =
  | { readonly action: "app"; readonly label: "Open in T3" }
  | { readonly action: "external"; readonly label: "Open externally" };

export type ResolveForkAlternateOpenMenuEntryInput =
  | {
      readonly kind: "file";
      readonly setting: ForkOpenFilesIn;
      readonly canOpenLocally: boolean;
      readonly canOpenInApp: boolean;
    }
  | {
      readonly kind: "link";
      readonly setting: ForkOpenLinksIn;
      readonly canOpenExternally: boolean;
      readonly canOpenInApp: boolean;
    };

export function resolveForkAlternateOpenMenuEntry(
  input: ResolveForkAlternateOpenMenuEntryInput,
): ForkAlternateOpenMenuEntry | null {
  if (input.kind === "file") {
    if (!input.canOpenLocally) return null;
    if (input.setting === "external") {
      return input.canOpenInApp ? { action: "app", label: "Open in T3" } : null;
    }
    return { action: "external", label: "Open externally" };
  }

  if (!input.canOpenExternally) return null;
  if (input.setting === "system") {
    return input.canOpenInApp ? { action: "app", label: "Open in T3" } : null;
  }
  return { action: "external", label: "Open externally" };
}

export function resolveForkLinkAction(input: {
  readonly url: string;
  readonly setting: ForkOpenLinksIn;
  readonly event?: {
    readonly metaKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly button?: number | undefined;
  };
  readonly canOpenInApp: boolean;
}): "system" | "app" | "reject" {
  if (!isSafeExternalBrowserUrl(input.url)) return "reject";
  if (isMailtoUrl(input.url)) return "system";
  if (input.event?.metaKey || input.event?.ctrlKey || input.event?.button === 1) return "system";
  if (input.setting !== "app") return "system";
  if (!input.canOpenInApp) return "system";
  return "app";
}

export function shouldInterceptInAppLink(setting: ForkOpenLinksIn): boolean {
  return setting === "app";
}

export function resolveForkFileAction(input: {
  readonly setting: ForkOpenFilesIn;
  readonly canOpenLocally: boolean;
  readonly altKey?: boolean;
}): "external" | "app" {
  if (input.setting !== "external" || !input.canOpenLocally || input.altKey === true) {
    return "app";
  }
  return "external";
}

export function resolveLocalFileAbsolutePath(input: {
  readonly path: string;
  readonly cwd?: string | undefined;
}): string | null {
  const raw = input.path.trim();
  if (raw.length === 0 || CONTROL_CHAR_PATTERN.test(raw)) return null;
  if (UNC_OR_DEVICE_PATH_PATTERN.test(raw)) return null;

  const hashIndex = raw.indexOf("#");
  const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : raw.slice(hashIndex);
  const stripped = splitFilePathPosition(withoutHash, hash).path;
  if (stripped.length === 0 || CONTROL_CHAR_PATTERN.test(stripped)) return null;
  if (UNC_OR_DEVICE_PATH_PATTERN.test(stripped)) return null;

  const isWindowsDrive = WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(stripped);
  if (!isWindowsDrive && URI_SCHEME_PATTERN.test(stripped)) return null;

  if (isAbsolutePath(stripped)) {
    return stripped;
  }
  if (!input.cwd || input.cwd.trim().length === 0) return null;
  const resolved = splitFilePathPosition(resolvePathLinkTarget(stripped, input.cwd)).path;
  if (UNC_OR_DEVICE_PATH_PATTERN.test(resolved) || !isAbsolutePath(resolved)) return null;
  return resolved;
}
