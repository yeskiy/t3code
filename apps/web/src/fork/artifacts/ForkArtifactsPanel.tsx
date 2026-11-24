/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFileName,
  htmlRenderFrameHeight,
} from "@t3tools/shared/htmlRender";
import { ArrowLeftIcon, LayersIcon } from "lucide-react";
import { useState } from "react";

import { useLongLivedAssetUrl } from "~/assets/longLivedAssetUrls";
import { HtmlRenderDocument } from "~/components/files/BrowserDocumentFrame";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useClientSettings } from "~/hooks/useSettings";
import { observeResize } from "~/lib/observeResize";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";
import { formatDayAwareTimestamp, formatFullTimestamp } from "~/timestampFormat";

import {
  extractThreadHtmlArtifacts,
  resolveSelectedArtifact,
  type ThreadHtmlArtifact,
} from "./artifacts.logic";
import { useForkArtifactsEnabled } from "./forkArtifactsSetting";
import { selectThreadArtifactId, useForkArtifactsStore } from "./forkArtifactsStore";

function ArtifactViewer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly artifact: ThreadHtmlArtifact;
  readonly timestampFormat: TimestampFormat;
  readonly onBack: () => void;
}) {
  const { attachmentId, title, htmlRender, createdAt } = props.artifact;
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  const observeBox = (box: HTMLDivElement) => {
    setWidth(box.clientWidth || HTML_RENDER_COLUMN_WIDTH);
    return observeResize(box, ([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setWidth(Math.round(entry.contentRect.width));
      }
    });
  };
  const [contentHeight, setContentHeight] = useState<number>();
  const height = htmlRenderFrameHeight(htmlRender, width, contentHeight);
  const resource = {
    _tag: "attachment" as const,
    attachmentId,
    fileName: htmlRenderFileName(title),
    mimeType: "text/html",
    disposition: "inline" as const,
  };
  // Keep the first loaded URL so signed-URL renewals do not reload the page.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const assetUrl = useLongLivedAssetUrl(loadedUrl === null ? props.environmentId : null, resource);
  if (loadedUrl === null && assetUrl._tag === "Success") {
    setLoadedUrl(assetUrl.url);
  }
  const src = loadedUrl;
  const failed = loadedUrl === null && assetUrl._tag === "Failure";
  const timeLabel = formatDayAwareTimestamp(createdAt, props.timestampFormat);
  const fullTime = formatFullTimestamp(createdAt, props.timestampFormat);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-fork-artifact-viewer={attachmentId}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0"
          onClick={props.onBack}
          aria-label="Back to artifacts"
        >
          <ArrowLeftIcon className="size-3.5" />
          <span>Artifacts</span>
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground text-xs">{title}</span>
        {timeLabel ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <time
                  dateTime={createdAt}
                  className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground"
                />
              }
            >
              {timeLabel}
            </TooltipTrigger>
            <TooltipPopup side="bottom">{fullTime}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div ref={observeBox} className="min-h-full w-full">
          {src !== null ? (
            <div style={{ height }}>
              <HtmlRenderDocument
                src={src}
                title={title}
                threadRef={props.threadRef}
                className="block size-full"
                onContentHeight={setContentHeight}
              />
            </div>
          ) : failed ? (
            <p className="flex h-40 items-center justify-center text-muted-foreground text-xs">
              Unable to load {title}
            </p>
          ) : (
            <p className="flex h-40 items-center justify-center text-muted-foreground text-xs">
              Loading {title}...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ForkArtifactsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const [enabled, setEnabled] = useForkArtifactsEnabled();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const visibleTurnItems = useQuietThreadVisibleTurnItems(props.threadRef);
  const selectedAttachmentId = useForkArtifactsStore((state) =>
    selectThreadArtifactId(state.selectedAttachmentIdByThreadKey, props.threadRef),
  );
  const selectArtifact = useForkArtifactsStore((state) => state.selectArtifact);

  if (!enabled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <LayersIcon className="size-6 text-muted-foreground/70" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-foreground text-sm">Artifacts panel is off</p>
          <p className="max-w-xs text-muted-foreground text-xs">
            Turn on &ldquo;Show renders as artifacts&rdquo; in Settings to list HTML renders in this
            panel.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEnabled(true)}>
          Turn on
        </Button>
      </div>
    );
  }

  const artifacts = extractThreadHtmlArtifacts(visibleTurnItems);
  const selected = resolveSelectedArtifact(artifacts, selectedAttachmentId);

  if (selected !== null) {
    return (
      <ArtifactViewer
        key={selected.attachmentId}
        environmentId={props.environmentId}
        threadRef={props.threadRef}
        artifact={selected}
        timestampFormat={timestampFormat}
        onBack={() => selectArtifact(props.threadRef, null)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-fork-artifacts-panel>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="font-medium text-foreground text-xs">Artifacts</h2>
        {artifacts.length > 0 ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs tabular-nums text-muted-foreground">
            {artifacts.length}
          </span>
        ) : null}
      </div>

      {artifacts.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <LayersIcon className="size-6 text-muted-foreground/70" aria-hidden />
          <p className="font-medium text-foreground text-sm">No artifacts yet</p>
          <p className="max-w-xs text-muted-foreground text-xs">
            HTML renders from this thread appear here newest first. Click one to open it full size.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          <ul className="flex flex-col gap-1" aria-label="Thread artifacts">
            {artifacts.map((artifact) => {
              const timeLabel = formatDayAwareTimestamp(artifact.createdAt, timestampFormat);
              return (
                <li key={artifact.attachmentId}>
                  <button
                    type="button"
                    onClick={() => selectArtifact(props.threadRef, artifact.attachmentId)}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <LayersIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
                      {artifact.title}
                    </span>
                    {timeLabel ? (
                      <time
                        dateTime={artifact.createdAt}
                        className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground"
                      >
                        {timeLabel}
                      </time>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
