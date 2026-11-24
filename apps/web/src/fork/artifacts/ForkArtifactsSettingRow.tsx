/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";

import { useForkArtifactsEnabled } from "./forkArtifactsSetting";

export function ForkArtifactsSettingRow() {
  const [enabled, setEnabled] = useForkArtifactsEnabled();
  return (
    <SettingsRow
      title="Show renders as artifacts"
      description="List HTML renders from the current thread in the right panel so you can open them full size. Inline chat renders stay visible."
      devicePreference
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          aria-label="Show renders as artifacts"
        />
      }
    />
  );
}
