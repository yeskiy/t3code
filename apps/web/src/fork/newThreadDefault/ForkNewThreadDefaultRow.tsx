/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { SettingsRow } from "~/components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useForkNewThreadDefault } from "./forkNewThreadDefault";

const LABELS = { scratch: "No project", lastUsed: "Last used project" } as const;

export function ForkNewThreadDefaultRow() {
  const [value, setValue] = useForkNewThreadDefault();
  return (
    <SettingsRow
      title="New threads open in"
      description="The T3 Code button, app start, and the new thread shortcut open this. Shift-click New thread or press the new local thread shortcut for the current project."
      devicePreference
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (next === "scratch" || next === "lastUsed") setValue(next);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="New threads open in">
            <SelectValue>{LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="scratch">
              {LABELS.scratch}
            </SelectItem>
            <SelectItem hideIndicator value="lastUsed">
              {LABELS.lastUsed}
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}
