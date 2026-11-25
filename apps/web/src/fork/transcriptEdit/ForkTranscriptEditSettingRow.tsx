/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";

import { useForkTranscriptEditEnabled } from "./transcriptEditSetting";

export function ForkTranscriptEditSettingRow() {
  const [enabled, setEnabled] = useForkTranscriptEditEnabled();
  return (
    <SettingsRow
      title="Transcript editing"
      description="Show Edit and Select on messages of Claude threads."
      devicePreference
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          aria-label="Transcript editing"
        />
      }
    />
  );
}
