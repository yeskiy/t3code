/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptViewBlock, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useForkTranscriptFullText } from "./forkTranscriptFullText";

export const FORK_TRANSCRIPT_CODE_CLASS_NAME =
  "max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text";

const READ_ONLY_LABEL: Partial<Record<ForkTranscriptViewBlock["type"], string>> = {
  thinking: "Thinking",
  redacted_thinking: "Redacted thinking",
  tool_use: "Tool call",
  tool_result: "Tool result",
  image: "Image",
  other: "Other content",
};

function ReadOnlyBlock(props: {
  readonly block: ForkTranscriptViewBlock;
  readonly threadRef: ScopedThreadRef;
  readonly baseKey: string;
  readonly removed: boolean;
  readonly onToggleRemove: () => void;
}) {
  const { block } = props;
  const [open, setOpen] = useState(false);
  const fullText = useForkTranscriptFullText({
    threadRef: props.threadRef,
    baseKey: props.baseKey,
    uuid: block.uuid,
    index: block.index,
    part: "block",
  });
  const label = block.type === "tool_use" && block.name ? `Tool call: ${block.name}` : null;
  const hasBody = block.type !== "image" && block.type !== "other";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground">
        {hasBody ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn("size-3 transition-transform", open && "rotate-90")}
            />
            <span className={cn(props.removed && "line-through")}>
              {label ?? READ_ONLY_LABEL[block.type]}
            </span>
          </button>
        ) : (
          <span>{READ_ONLY_LABEL[block.type]}</span>
        )}
        {block.isError ? <Badge variant="destructive">Error</Badge> : null}
        {block.removable ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="micro"
                  variant="ghost"
                  aria-pressed={props.removed}
                  onClick={props.onToggleRemove}
                />
              }
            >
              {props.removed ? "Keep" : "Remove"}
            </TooltipTrigger>
            <TooltipPopup side="top">
              Signed block. You can remove it, but not edit it.
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {open && hasBody ? (
        <div className="flex flex-col gap-1 ps-4">
          <pre className={FORK_TRANSCRIPT_CODE_CLASS_NAME}>{fullText.full ?? block.text}</pre>
          {block.truncated && fullText.full === null ? (
            <Button
              type="button"
              size="micro"
              variant="ghost"
              className="self-start"
              disabled={fullText.busy}
              onClick={fullText.showAll}
            >
              {fullText.failed ? "Could not load the full text. Try again" : "Show all"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ForkTranscriptBlockField({
  ref,
  ...props
}: {
  readonly block: ForkTranscriptViewBlock;
  readonly value: string | undefined;
  readonly removed: boolean;
  readonly threadRef: ScopedThreadRef;
  readonly baseKey: string;
  readonly ref?: Ref<HTMLTextAreaElement> | undefined;
  readonly invalid: boolean;
  readonly onChange: (next: string) => void;
  readonly onToggleRemove: () => void;
}) {
  if (props.block.editable && props.value !== undefined) {
    return (
      <Textarea
        ref={ref}
        size="sm"
        value={props.value}
        aria-label={props.block.type === "system" ? "System content" : "Message text"}
        aria-invalid={props.invalid || undefined}
        style={{ maxHeight: "60vh" }}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <ReadOnlyBlock
      block={props.block}
      threadRef={props.threadRef}
      baseKey={props.baseKey}
      removed={props.removed}
      onToggleRemove={props.onToggleRemove}
    />
  );
}
