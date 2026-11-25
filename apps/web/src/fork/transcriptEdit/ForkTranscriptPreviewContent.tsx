import type { ForkTranscriptUnitView } from "@t3tools/contracts";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/assistantInsights";
import { use } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { MESSAGE_HEADING_LEVEL } from "~/components/chat/TimelineRowParts";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import type { MarkdownExtensions } from "~/markdown/wordsHast";
import { UNIT_KIND_LABEL } from "./pendingLooks.logic";

const USER_MARKDOWN: MarkdownExtensions = { userMessage: true, leadingWhitespace: true };

const unitText = (unit: ForkTranscriptUnitView): string =>
  unit.blocks
    .filter((block) => block.type === "text" || block.type === "system")
    .map((block) => block.text)
    .join("\n\n");

/** A unit in the layout of the timeline row of its role. */
export function ForkTranscriptPreviewContent(props: { readonly unit: ForkTranscriptUnitView }) {
  const { unit } = props;
  const ctx = use(TimelineRowCtx);
  const text = unitText(unit);
  const threadRef = ctx.threadRef ?? undefined;

  if (unit.kind === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="relative min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
          <ChatMarkdown
            text={text}
            cwd={ctx.markdownCwd}
            threadRef={threadRef}
            skills={ctx.skills}
            className="text-message-foreground user-message-markdown"
            lineBreaks
            parseRawHtml={false}
            extensions={USER_MARKDOWN}
            headingLevelOffset={MESSAGE_HEADING_LEVEL}
          />
        </div>
      </div>
    );
  }

  if (unit.kind === "assistant") {
    return (
      <div className="min-w-0 px-1 py-0.5">
        <ChatMarkdown
          text={text}
          cwd={ctx.markdownCwd}
          threadRef={threadRef}
          skills={ctx.skills}
          lineBreaks={shouldPreserveAssistantLineBreaks(text)}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-8 min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
      <span className="shrink-0 font-medium">{UNIT_KIND_LABEL[unit.kind]}</span>
      <span className="min-w-0 truncate">{unit.excerpt}</span>
    </div>
  );
}
