/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import type { ForkAllowedDelegationTargets, ProviderInstanceId } from "@t3tools/contracts";
import { useState } from "react";

import { SettingResetButton, SettingsRow } from "~/components/settings/settingsLayout";
import { DraftInput } from "~/components/ui/draft-input";
import {
  formatForkDelegationTargets,
  parseForkDelegationTargetsInput,
} from "./delegationTargets.logic";

const FIELD_TITLE = "Allowed delegation targets";
const FIELD_DESCRIPTION =
  "Comma-separated provider instance IDs that this instance may delegate to. Empty: any instance.";
const INVALID_VALUE_MESSAGE =
  "Enter comma-separated instance IDs using letters, numbers, hyphens, or underscores. The value was not saved.";
const BLOCKED_ALL_MESSAGE =
  "All delegation is blocked (empty list). Enter IDs or reset to allow any instance.";

interface RejectedDraft {
  readonly syncedValue: ReadonlyArray<ProviderInstanceId> | undefined;
  readonly text: string;
}

export function ForkDelegationTargetsRow({
  idPrefix,
  value,
  onCommit,
}: {
  readonly idPrefix: string;
  readonly value: ReadonlyArray<ProviderInstanceId> | undefined;
  readonly onCommit: (next: ForkAllowedDelegationTargets | undefined) => void;
}) {
  const [rejected, setRejected] = useState<RejectedDraft | null>(null);
  const inputId = `${idPrefix}-allowedDelegationTargets`;
  const descriptionId = `${inputId}-description`;
  const activeRejectedText =
    rejected !== null && rejected.syncedValue === value ? rejected.text : null;

  return (
    <SettingsRow
      title={<label htmlFor={inputId}>{FIELD_TITLE}</label>}
      description={<span id={descriptionId}>{FIELD_DESCRIPTION}</span>}
      resetAction={
        value !== undefined ? (
          <SettingResetButton
            ariaLabel="Allow any delegation target"
            tooltip="Allow any instance"
            onClick={() => {
              setRejected(null);
              onCommit(undefined);
            }}
          />
        ) : null
      }
      control={
        <div className="flex w-full min-w-0 flex-col gap-1 @min-[32rem]/settings-row:w-56">
          <DraftInput
            id={inputId}
            aria-describedby={descriptionId}
            size="sm"
            font="mono"
            className="w-full max-w-full"
            value={activeRejectedText ?? formatForkDelegationTargets(value)}
            placeholder="Empty: any instance"
            onCommit={(next) => {
              const parsed = parseForkDelegationTargetsInput(next);
              if (parsed.kind === "invalid") {
                setRejected({ syncedValue: value, text: next });
                return;
              }
              setRejected(null);
              onCommit(parsed.kind === "empty" ? undefined : parsed.targets);
            }}
            aria-invalid={activeRejectedText !== null || undefined}
            spellCheck={false}
          />
          {activeRejectedText !== null ? (
            <p className="text-2xs text-destructive">{INVALID_VALUE_MESSAGE}</p>
          ) : value !== undefined && value.length === 0 ? (
            <p className="text-2xs text-muted-foreground">{BLOCKED_ALL_MESSAGE}</p>
          ) : null}
        </div>
      }
    />
  );
}
