/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptUnitView } from "@t3tools/contracts";

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
import { useClientSettings } from "~/hooks/useSettings";
import { formatDateTimeTimestamp } from "~/timestampFormat";
import { UNIT_KIND_LABEL } from "./pendingLooks.logic";

/** Picks the unit that the selected units go after, or the start of the transcript. */
export function ForkTranscriptMoveDialog(props: {
  readonly open: boolean;
  readonly units: ReadonlyArray<ForkTranscriptUnitView>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onMove: (afterKey: string | null) => void;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const count = props.selectedKeys.size;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{count === 1 ? "Move 1 message" : `Move ${count} messages`}</DialogTitle>
          <DialogDescription>
            Pick the place. The messages keep their order. The move stays pending until you save.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ol className="flex flex-col" aria-label="Places">
            <li className="flex items-center gap-3 border-b border-border py-2 text-sm">
              <span className="min-w-0 flex-1 font-medium">The start of the transcript</span>
              <Button size="xs" variant="outline" onClick={() => props.onMove(null)}>
                Put at the start
              </Button>
            </li>
            {props.units
              .filter((unit) => !props.selectedKeys.has(unit.key))
              .map((unit) => (
                <li
                  key={unit.key}
                  className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-b-0"
                  data-fork-transcript-move-place={unit.key}
                >
                  <span className="w-20 shrink-0 font-medium">{UNIT_KIND_LABEL[unit.kind]}</span>
                  <span className="w-36 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {unit.time === null ? "" : formatDateTimeTimestamp(unit.time, timestampFormat)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {unit.excerpt}
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => props.onMove(unit.key)}>
                    Put after
                  </Button>
                </li>
              ))}
          </ol>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
