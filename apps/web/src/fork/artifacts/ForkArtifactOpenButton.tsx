/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { PanelRightOpenIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { useForkArtifactsEnabled } from "./forkArtifactsSetting";
import { openArtifactInPanel } from "./forkArtifactsStore";

export function ForkArtifactOpenButton(props: {
  readonly threadRef: ScopedThreadRef | undefined;
  readonly attachmentId: string;
}) {
  const [enabled] = useForkArtifactsEnabled();
  if (!enabled || props.threadRef === undefined) return null;
  const threadRef = props.threadRef;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Open in artifacts panel"
            size="icon-xs"
            variant="glass"
            onClick={() => openArtifactInPanel(threadRef, props.attachmentId)}
          />
        }
      >
        <PanelRightOpenIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="left">Open in artifacts panel</TooltipPopup>
    </Tooltip>
  );
}
