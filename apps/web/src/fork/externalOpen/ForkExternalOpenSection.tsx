/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useUpdatePrimarySettings } from "~/hooks/useSettings";
import { useForkOpenFilesIn, useForkOpenLinksIn } from "./forkExternalOpen";

const LINK_LABELS = {
  system: "System browser",
  app: "T3 browser",
} as const;

const FILE_LABELS = {
  external: "Default app",
  app: "T3 viewer",
} as const;

export function ForkExternalOpenSection() {
  const [openLinksIn, setOpenLinksIn] = useForkOpenLinksIn();
  const [openFilesIn, setOpenFilesIn] = useForkOpenFilesIn();
  const updatePrimarySettings = useUpdatePrimarySettings();

  return (
    <SettingsSection id="fork-external-open" title="Opening links and files">
      <SettingsRow
        title="Open links in"
        description="Controls where clicked web, pull request, issue, mail, and local server links open. Agent browser tools still use the built-in browser."
        devicePreference
        control={
          <Select
            value={openLinksIn}
            onValueChange={(next) => {
              if (next === "system" || next === "app") {
                setOpenLinksIn(next);
                updatePrimarySettings({ browserLinkTarget: next });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Open links in">
              <SelectValue>{LINK_LABELS[openLinksIn]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="system">
                {LINK_LABELS.system}
              </SelectItem>
              <SelectItem hideIndicator value="app">
                {LINK_LABELS.app}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Open files in"
        description="Controls where clicked local files, HTML pages, PDFs, and images open. Hold Alt while clicking a chat file link to open it in T3 Code."
        devicePreference
        control={
          <Select
            value={openFilesIn}
            onValueChange={(next) => {
              if (next === "external" || next === "app") {
                setOpenFilesIn(next);
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Open files in">
              <SelectValue>{FILE_LABELS[openFilesIn]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="external">
                {FILE_LABELS.external}
              </SelectItem>
              <SelectItem hideIndicator value="app">
                {FILE_LABELS.app}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
