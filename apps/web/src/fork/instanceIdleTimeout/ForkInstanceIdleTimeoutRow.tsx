/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkInstanceIdleTimeoutMinutes } from "@t3tools/contracts";
import { useState } from "react";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { DraftInput } from "~/components/ui/draft-input";
import {
  formatForkInstanceIdleTimeoutMinutes,
  parseForkInstanceIdleTimeoutInput,
} from "./instanceIdleTimeout.logic";

const FIELD_TITLE = "Keep idle process (minutes)";
const FIELD_DESCRIPTION =
  "How long T3 keeps the provider process after a turn. Empty uses the default: 2 minutes for providers that can resume, 30 for others. A longer time keeps MCP servers, such as a browser, alive, and uses more memory.";
const INVALID_VALUE_MESSAGE = "Enter a whole number from 1 to 1440. The value was not saved.";

interface RejectedDraft {
  readonly syncedValue: number | undefined;
  readonly text: string;
}

export function ForkInstanceIdleTimeoutRow({
  idPrefix,
  value,
  onCommit,
}: {
  readonly idPrefix: string;
  readonly value: number | undefined;
  readonly onCommit: (next: ForkInstanceIdleTimeoutMinutes | undefined) => void;
}) {
  const [rejected, setRejected] = useState<RejectedDraft | null>(null);
  const inputId = `${idPrefix}-idleTimeoutMinutes`;
  const descriptionId = `${inputId}-description`;
  const activeRejectedText =
    rejected !== null && rejected.syncedValue === value ? rejected.text : null;

  return (
    <SettingsRow
      title={<label htmlFor={inputId}>{FIELD_TITLE}</label>}
      description={<span id={descriptionId}>{FIELD_DESCRIPTION}</span>}
      control={
        <div className="flex w-full min-w-0 flex-col gap-1 @min-[32rem]/settings-row:w-56">
          <DraftInput
            id={inputId}
            aria-describedby={descriptionId}
            size="sm"
            className="w-full max-w-full"
            inputMode="numeric"
            value={activeRejectedText ?? formatForkInstanceIdleTimeoutMinutes(value)}
            placeholder="Default"
            onCommit={(next) => {
              const parsed = parseForkInstanceIdleTimeoutInput(next);
              if (parsed.kind === "invalid") {
                setRejected({ syncedValue: value, text: next });
                return;
              }
              setRejected(null);
              onCommit(parsed.kind === "empty" ? undefined : parsed.minutes);
            }}
            aria-invalid={activeRejectedText !== null || undefined}
            spellCheck={false}
          />
          {activeRejectedText !== null ? (
            <p className="text-2xs text-destructive">{INVALID_VALUE_MESSAGE}</p>
          ) : null}
        </div>
      }
    />
  );
}
