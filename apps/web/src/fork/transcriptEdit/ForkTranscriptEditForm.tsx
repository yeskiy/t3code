/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkTranscriptOp, ForkTranscriptUnitView, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, LockIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { TimelineRowTimestamp } from "~/components/chat/TimelineRowParts";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { isMacPlatform } from "~/lib/utils";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { ForkTranscriptBlockField } from "./ForkTranscriptBlockField";
import { ForkTranscriptEntryFields } from "./ForkTranscriptEntryFields";
import { blockKey, formStep, hasEmptyText } from "./formSteps.logic";
import type { Step } from "./history.logic";

const KIND_LABEL: Record<ForkTranscriptUnitView["kind"], string> = {
  preamble: "Preamble",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
  system: "System",
};

const KIND_NOUN: Record<ForkTranscriptUnitView["kind"], string> = {
  preamble: "preamble",
  user: "user message",
  assistant: "assistant message",
  tool: "tool call",
  system: "system entry",
};

const unitStep = (
  unit: ForkTranscriptUnitView,
  label: string,
  op: ForkTranscriptOp,
): Omit<Step, "id"> => ({
  label,
  unitKeys: [unit.key],
  items: [{ op, at: new Date().toISOString() }],
});

export function ForkTranscriptEditForm(props: {
  readonly unit: ForkTranscriptUnitView;
  readonly units: ReadonlyArray<ForkTranscriptUnitView>;
  readonly inherited: boolean;
  readonly baseKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly timestampFormat: TimestampFormat;
  readonly onStep: (step: Omit<Step, "id">) => void;
  readonly onClose: () => void;
}) {
  const { unit } = props;
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(
    () =>
      new Map(
        unit.blocks.filter((block) => block.editable).map((block) => [blockKey(block), block.text]),
      ),
  );
  const [removedThinking, setRemovedThinking] = useState<ReadonlySet<string>>(() => new Set());
  const [showEmptyError, setShowEmptyError] = useState(false);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves focus into the form once it opens
  useLayoutEffect(() => {
    (firstFieldRef.current ?? formRef.current)?.focus();
  }, []);

  const values = { texts, removedThinking };
  const emptyText = hasEmptyText(unit, values);
  const index = props.units.findIndex((candidate) => candidate.key === unit.key);
  const firstMovable = props.units.findIndex((candidate) => !candidate.locked);
  const canMoveUp = !unit.locked && index > 0 && index - 1 >= firstMovable;
  const canMoveDown = !unit.locked && index >= 0 && index + 1 < props.units.length;
  const firstEditableIndex = unit.blocks.findIndex((block) => block.editable);

  const apply = () => {
    if (emptyText) {
      setShowEmptyError(true);
      return;
    }
    const step = formStep(unit, values);
    if (step !== null) props.onStep(step);
    props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      apply();
    }
  };

  return (
    <div
      ref={formRef}
      role="group"
      aria-label={`Edit ${KIND_NOUN[unit.kind]}`}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 text-sm outline-none"
      data-fork-transcript-edit-form={unit.key}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{KIND_LABEL[unit.kind]}</span>
        {unit.time === null ? null : (
          <TimelineRowTimestamp
            createdAt={unit.time}
            timestampFormat={props.timestampFormat}
            alwaysVisible
          />
        )}
        {unit.locked ? <LockIcon aria-label="Locked" className="size-3" /> : null}
      </div>
      {unit.blocks.map((block, blockIndex) => {
        const key = blockKey(block);
        const value = texts.get(key);
        return (
          <ForkTranscriptBlockField
            key={key}
            block={block}
            value={value}
            removed={removedThinking.has(key)}
            threadRef={props.threadRef}
            baseKey={props.baseKey}
            ref={blockIndex === firstEditableIndex ? firstFieldRef : undefined}
            invalid={showEmptyError && value !== undefined && value.trim().length === 0}
            onChange={(next) => {
              setShowEmptyError(false);
              setTexts((current) => new Map(current).set(key, next));
            }}
            onToggleRemove={() =>
              setRemovedThinking((current) => {
                const next = new Set(current);
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
          />
        );
      })}
      {showEmptyError && emptyText ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          The text cannot be empty.
        </p>
      ) : null}
      <ForkTranscriptEntryFields
        entries={unit.entries}
        threadRef={props.threadRef}
        baseKey={props.baseKey}
      />
      {props.inherited ? (
        <p className="text-xs text-muted-foreground">
          This message comes from the parent thread. The save changes the session file of this
          thread. The parent thread keeps the old text.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {unit.locked ? null : (
          <Button type="button" size="xs" onClick={apply}>
            Apply
            <Kbd>{`${isMacPlatform(navigator.platform) ? "⌘" : "Ctrl"}+Enter`}</Kbd>
          </Button>
        )}
        <Button type="button" size="xs" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        {unit.locked ? null : (
          <Menu>
            <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
              More
              <ChevronDownIcon aria-hidden="true" className="size-3" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                variant="destructive"
                onClick={() => {
                  props.onStep(
                    unitStep(unit, `Deleted ${KIND_NOUN[unit.kind]}`, {
                      kind: "deleteUnit",
                      unit: unit.key,
                    }),
                  );
                  props.onClose();
                }}
              >
                Delete
              </MenuItem>
              <MenuItem
                disabled={!canMoveUp}
                onClick={() => {
                  props.onStep(
                    unitStep(unit, `Moved ${KIND_NOUN[unit.kind]} up`, {
                      kind: "moveUnit",
                      unit: unit.key,
                      toIndex: index - 1,
                    }),
                  );
                  props.onClose();
                }}
              >
                Move up
              </MenuItem>
              <MenuItem
                disabled={!canMoveDown}
                onClick={() => {
                  props.onStep(
                    unitStep(unit, `Moved ${KIND_NOUN[unit.kind]} down`, {
                      kind: "moveUnit",
                      unit: unit.key,
                      toIndex: index + 1,
                    }),
                  );
                  props.onClose();
                }}
              >
                Move down
              </MenuItem>
            </MenuPopup>
          </Menu>
        )}
      </div>
    </div>
  );
}
