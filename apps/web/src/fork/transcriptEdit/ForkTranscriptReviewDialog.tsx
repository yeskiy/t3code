/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { ForkTranscriptDiffItem, ScopedThreadRef } from "@t3tools/contracts";
import { CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { useForkTranscriptEditSession } from "./editSession";
import { patchSaveBar, useForkTranscriptSaveBarState } from "./saveFlow";

const TEXT_CUT = 600;

const KIND_LABEL: Record<ForkTranscriptDiffItem["kind"], string> = {
  user: "You",
  assistant: "Assistant",
  tool: "Tool",
  system: "System",
  preamble: "Session start",
};

const STATUS: Record<
  ForkTranscriptDiffItem["status"],
  { readonly label: string; readonly variant: "success" | "error" | "outline" | "info" }
> = {
  added: { label: "Inserted", variant: "success" },
  removed: { label: "Removed", variant: "error" },
  changed: { label: "Edited", variant: "info" },
  moved: { label: "Moved", variant: "outline" },
  movedChanged: { label: "Moved and edited", variant: "info" },
};

function ClippedText(props: { readonly text: string; readonly muted?: boolean }) {
  const [all, setAll] = useState(false);
  const long = props.text.length > TEXT_CUT;
  return (
    <div className="flex flex-col items-start gap-1">
      <p
        className={
          props.muted === true
            ? "w-full rounded-md bg-muted/48 px-2.5 py-2 text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere"
            : "w-full rounded-md bg-muted/48 px-2.5 py-2 text-xs whitespace-pre-wrap wrap-anywhere"
        }
      >
        {all || !long ? props.text : `${props.text.slice(0, TEXT_CUT)}...`}
      </p>
      {long ? (
        <Button size="xs" variant="link" onClick={() => setAll(!all)}>
          {all ? "Show less" : "Show all"}
        </Button>
      ) : null}
    </div>
  );
}

function TextDiff(props: { readonly before: string; readonly after: string }) {
  const appearance = useRenderedAppearance();
  return (
    <div className="overflow-hidden rounded-md border">
      <FileDiff
        fileDiff={parseDiffFromFile(
          { name: "message.txt", contents: props.before },
          { name: "message.txt", contents: props.after },
        )}
        options={{
          diffStyle: "unified",
          overflow: "wrap",
          disableFileHeader: true,
          theme: resolveDiffThemeName(appearance),
          preferredHighlighter: PREFERRED_HIGHLIGHTER,
        }}
      />
    </div>
  );
}

const changeBody = (item: ForkTranscriptDiffItem): ReactNode => {
  if ((item.status === "changed" || item.status === "movedChanged") && item.before !== null) {
    return <TextDiff before={item.before} after={item.after ?? ""} />;
  }
  if (item.status === "removed") return <ClippedText text={item.before ?? ""} muted />;
  return <ClippedText text={item.after ?? item.before ?? ""} />;
};

function ChangeRow(props: { readonly item: ForkTranscriptDiffItem; readonly index: number }) {
  const status = STATUS[props.item.status];
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
          {props.index + 1}
        </span>
        <span className="text-sm font-medium">{KIND_LABEL[props.item.kind]}</span>
        <Badge variant={status.variant}>{status.label}</Badge>
        {props.item.status === "moved" ? (
          <span className="text-xs text-muted-foreground">Same text in a new place.</span>
        ) : null}
      </div>
      {changeBody(props.item)}
    </li>
  );
}

function ValidationSummary(props: { readonly threadKey: string }) {
  const session = useForkTranscriptEditSession(props.threadKey);
  const validation = session.preview?.validation ?? session.load?.validation;
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  if (errors.length > 0) {
    return (
      <div role="alert" className="flex flex-col gap-1 rounded-lg bg-destructive/8 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <CircleAlertIcon aria-hidden="true" className="size-4" />
          {errors.length === 1 ? "1 error" : `${errors.length} errors`}. Saving is blocked until the
          errors are gone. If a change caused them, revert it.
        </p>
        <ul className="flex list-disc flex-col gap-0.5 pl-9 text-xs text-muted-foreground">
          {errors.map((issue) => (
            <li key={`${issue.code}:${issue.uuid ?? ""}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-sm text-success-foreground">
        <CircleCheckIcon aria-hidden="true" className="size-4" />
        Validation passed.
      </p>
      {warnings.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-1.5 text-warning-foreground">
            <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
            {warnings.length === 1 ? "1 warning" : `${warnings.length} warnings`}
          </summary>
          <ul className="flex list-disc flex-col gap-0.5 pt-1 pl-9">
            {warnings.map((issue) => (
              <li key={`${issue.code}:${issue.uuid ?? ""}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ForkTranscriptReviewDialog(props: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly continueChoice: ReactNode;
  readonly saveBlocked: boolean;
  readonly onSave: () => void;
}) {
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(props.threadKey);
  const bar = useForkTranscriptSaveBarState(props.threadKey);
  const diff = session.preview?.diff ?? [];
  const failed = session.preview?.failedAt ?? null;
  return (
    <Dialog
      open={bar.review}
      onOpenChange={(open) => patchSaveBar(registry, props.threadKey, { review: open })}
    >
      <DialogPopup className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>
            Nothing is written yet. Save writes every change below to the session file in one write,
            after a backup.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ValidationSummary threadKey={props.threadKey} />
          <section className="flex flex-col gap-2" aria-label="Changes">
            <h3 className="text-sm font-semibold tabular-nums">
              {diff.length === 1 ? "1 change" : `${diff.length} changes`}
            </h3>
            {failed !== null ? (
              <p className="text-sm text-destructive">
                Change {failed.index + 1} cannot apply: {failed.message}
              </p>
            ) : session.preview === null ? (
              <p className="text-sm text-muted-foreground">The preview is not ready yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {diff.map((item, index) => (
                  <ChangeRow key={`${item.key}-${item.status}`} item={item} index={index} />
                ))}
              </ol>
            )}
          </section>
        </DialogPanel>
        <DialogFooter className="sm:items-center">
          <div className="mr-auto">{props.continueChoice}</div>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          <Button disabled={props.saveBlocked} onClick={props.onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
