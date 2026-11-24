/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { LayersIcon } from "lucide-react";

import { ThreadDetailsControl } from "~/components/chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "~/components/chat/ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "~/components/chat/threadDetailsPanelStyles";
import { cn } from "~/lib/utils";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";

import { extractThreadHtmlArtifacts } from "./artifacts.logic";
import { useForkArtifactsEnabled } from "./forkArtifactsSetting";
import { openArtifactsPanel } from "./forkArtifactsStore";

export function ForkThreadDetailsArtifactsRow(props: { readonly threadRef: ScopedThreadRef }) {
  const [enabled] = useForkArtifactsEnabled();
  const visibleTurnItems = useQuietThreadVisibleTurnItems(enabled ? props.threadRef : null);
  if (!enabled) return null;
  const artifacts = extractThreadHtmlArtifacts(visibleTurnItems);
  if (artifacts.length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-fork-artifacts-heading"
      title="Artifacts"
      showHeading={false}
    >
      <div className="flex flex-col">
        <ThreadDetailsControl
          size="xs"
          variant="ghost"
          part="row"
          panel
          onClick={() => openArtifactsPanel(props.threadRef)}
        >
          <LayersIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
          <span
            className={cn("ml-0.5 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
          >
            Artifacts
          </span>
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            {artifacts.length}
          </span>
        </ThreadDetailsControl>
      </div>
    </ThreadDetailsSection>
  );
}
