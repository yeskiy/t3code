import type { ContextMenuItem } from "@t3tools/contracts";
import {
  type SourceControlDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/client-runtime/source-control-clients";

import { msg } from "gt-react";

import {
  type ForkAlternateOpenMenuEntry,
  isSafeExternalBrowserUrl,
} from "~/fork/externalOpen/externalOpen.logic"; // fork: external open
import { resolveForkLinkMenuEntry } from "~/fork/externalOpen/forkExternalOpen"; // fork: external open
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { m, type MessageResolver } from "~/i18n/messages";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external" | "open-in-app";

export const openOnHostLabel = (
  host: SourceControlDefinition,
  resolve: MessageResolver = m,
): string =>
  host === UNKNOWN_SOURCE_CONTROL_CLIENT
    ? resolve(msg("Open on host"))
    : resolve(msg("Open on {host}", { host: host.label }));

export function pullRequestLinkContextMenuItems(
  openLabel: string,
  forkOpenEntry?: ForkAlternateOpenMenuEntry | null,
): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  // fork: show the single alternate open entry ("Open in T3" or "Open externally").
  const openItem: ContextMenuItem<PullRequestLinkContextMenuAction> =
    forkOpenEntry != null
      ? {
          id: forkOpenEntry.action === "app" ? "open-in-app" : "open-external",
          label: forkOpenEntry.label,
        }
      : { id: "open-external", label: openLabel };
  return [{ id: "copy-link", label: m(msg("Copy link")), icon: "copy" }, openItem];
}

export async function showPullRequestLinkContextMenu({
  url,
  openLabel,
  position,
  onOpenInApp,
}: {
  readonly url: string;
  readonly openLabel: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly onOpenInApp?: (() => Promise<void> | void) | undefined;
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  const forkOpenEntry = resolveForkLinkMenuEntry({
    url,
    canOpenInApp: onOpenInApp !== undefined,
  });
  let action: PullRequestLinkContextMenuAction | null = null;
  try {
    action = await api.contextMenu.show(
      pullRequestLinkContextMenuItems(openLabel, forkOpenEntry),
      position,
    );
  } catch {
    return;
  }
  try {
    if (action === "copy-link")
      await writeTextToClipboard(url, {
        target: "link",
        unavailableMessage: msg("Clipboard API is unavailable while copying link."),
        failureMessage: msg("Failed to copy link to the clipboard."),
      });
    else if (action === "open-in-app") await onOpenInApp?.();
    else if (action === "open-external" && isSafeExternalBrowserUrl(url))
      await api.shell.openExternal(url);
  } catch {
    toastManager.add({
      type: "error",
      title:
        action === "copy-link"
          ? m(msg("Could not copy the link"))
          : m(msg("Could not open the link")),
    });
  }
}
