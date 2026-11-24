import { useEffect } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { startForkScratchThread } from "~/fork/newThreadDefault/forkNewThreadDefault";
import { useScratchProject } from "~/hooks/useScratchProject";
import { handleForkTrayMenuAction } from "./forkTrayMenuAction";

export function ForkTrayMenuListener() {
  const scratch = useScratchProject();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the desktop tray menu action
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        handleForkTrayMenuAction(action, {
          startScratch: () => startForkScratchThread(scratch, null),
          openPicker: () => openCommandPalette({ open: "new-thread-in" }),
        });
      }),
    [scratch],
  );
  return null;
}
