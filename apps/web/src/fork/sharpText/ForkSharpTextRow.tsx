/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { isWindowsPlatform } from "~/lib/utils";
import { resolveForkSharpText } from "./sharpText.logic";
import { useForkSharpText } from "./sharpText";

export function ForkSharpTextRow() {
  const [stored, setStored] = useForkSharpText();
  if (!isWindowsPlatform(navigator.platform)) return null;
  return (
    <SettingsRow
      title="Sharp text"
      description="Makes menus, cards, and the composer fully opaque and removes blur, grain, and scroll fades, so Windows can draw ClearType text."
      devicePreference
      control={
        <Switch
          checked={resolveForkSharpText(stored, navigator.platform)}
          onCheckedChange={(checked) => setStored(Boolean(checked))}
          aria-label="Sharp text"
        />
      }
    />
  );
}
