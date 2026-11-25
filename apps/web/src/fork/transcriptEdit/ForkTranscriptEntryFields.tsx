/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptEntryView, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { MessageCopyButton } from "~/components/chat/MessageCopyButton";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { FORK_TRANSCRIPT_CODE_CLASS_NAME } from "./ForkTranscriptBlockField";
import { useForkTranscriptFullText } from "./forkTranscriptFullText";

function EntryFieldList(props: {
  readonly entry: ForkTranscriptEntryView;
  readonly threadRef: ScopedThreadRef;
  readonly baseKey: string;
}) {
  const { entry } = props;
  const [rawOpen, setRawOpen] = useState(false);
  const fullText = useForkTranscriptFullText({
    threadRef: props.threadRef,
    baseKey: props.baseKey,
    uuid: entry.uuid,
    index: null,
    part: "raw",
  });
  const fields = [
    ["Type", entry.type],
    ["UUID", entry.uuid],
    ["Parent UUID", entry.parentUuid],
    ["Timestamp", entry.timestamp],
    ["Message ID", entry.messageId],
    ["Model", entry.model],
  ] as const;
  return (
    <div className="flex flex-col gap-1">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 text-xs">
        {fields.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-(length:--font-size-code,var(--text-2xs))">
                {value ?? "None"}
              </span>
              {value === null ? null : (
                <MessageCopyButton text={value} label={`Copy ${name}`} variant="ghost" />
              )}
            </dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={rawOpen}
        onClick={() => setRawOpen((value) => !value)}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3 transition-transform", rawOpen && "rotate-90")}
        />
        Raw JSON
      </button>
      {rawOpen ? (
        <div className="flex flex-col gap-1 ps-4">
          <pre className={FORK_TRANSCRIPT_CODE_CLASS_NAME}>{fullText.full ?? entry.raw}</pre>
          {entry.rawTruncated && fullText.full === null ? (
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

export function ForkTranscriptEntryFields(props: {
  readonly entries: ReadonlyArray<ForkTranscriptEntryView>;
  readonly threadRef: ScopedThreadRef;
  readonly baseKey: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        Entry fields
      </button>
      {open ? (
        <div className="flex flex-col gap-3 ps-4">
          {props.entries.map((entry) => (
            <EntryFieldList
              key={entry.uuid}
              entry={entry}
              threadRef={props.threadRef}
              baseKey={props.baseKey}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
