/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { RegistryContext } from "@effect/atom-react";
import { use, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { isMacPlatform } from "~/lib/utils";
import { useForkTranscriptEditActions, useForkTranscriptEditSession } from "./editSession";
import { focusEditButton } from "./ForkTranscriptUnitForm";
import { insertStep } from "./pendingLooks.logic";
import { forkTranscriptInsertTargetAtom, type InsertTarget } from "./pendingState";

/** A draft composer that adds one "Inserted message" step above or below a unit. */
export function ForkTranscriptInsertComposer(props: { readonly target: InsertTarget }) {
  const { target } = props;
  const ctx = use(TimelineRowCtx);
  const registry = useContext(RegistryContext);
  const session = useForkTranscriptEditSession(ctx.routeThreadKey);
  const actions = useForkTranscriptEditActions(ctx.routeThreadKey, ctx.threadRef);
  const [role, setRole] = useState<"user" | "assistant">("user");
  const [text, setText] = useState("");
  const [showEmptyError, setShowEmptyError] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves focus into the composer once it opens
  useLayoutEffect(() => fieldRef.current?.focus(), []);
  const units = session.preview?.units ?? session.load?.units ?? [];
  if (session.load === null || !units.some((unit) => unit.key === target.unitKey)) return null;

  const close = () => {
    registry.set(forkTranscriptInsertTargetAtom(ctx.routeThreadKey), null);
    focusEditButton(target.rowId);
  };
  const insert = () => {
    if (text.trim().length === 0) {
      setShowEmptyError(true);
      return;
    }
    actions.addStep(insertStep(units, target.unitKey, target.position, role, text));
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      insert();
    }
  };

  return (
    <div className="pb-4">
      <div
        role="group"
        aria-label={`Insert a message ${target.position}`}
        className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 text-sm"
        data-fork-transcript-insert-composer={target.position}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">New message</span>
          <ToggleGroup
            aria-label="Role"
            value={[role]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "user" || value === "assistant") setRole(value);
            }}
          >
            <Toggle value="user">User</Toggle>
            <Toggle value="assistant">Assistant</Toggle>
          </ToggleGroup>
        </div>
        <Textarea
          ref={fieldRef}
          size="sm"
          aria-label="Message text"
          aria-invalid={showEmptyError || undefined}
          style={{ maxHeight: "60vh" }}
          value={text}
          onChange={(event) => {
            setShowEmptyError(false);
            setText(event.target.value);
          }}
        />
        {showEmptyError ? (
          <p className="text-xs text-destructive-foreground" role="alert">
            The text cannot be empty.
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-1.5">
          <Button type="button" size="xs" onClick={insert}>
            Insert
            <Kbd>{`${isMacPlatform(navigator.platform) ? "⌘" : "Ctrl"}+Enter`}</Kbd>
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
