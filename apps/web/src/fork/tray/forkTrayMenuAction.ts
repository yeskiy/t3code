export const FORK_TRAY_NEW_THREAD_ACTION = "fork.newThread";

export function handleForkTrayMenuAction(
  action: string,
  handlers: {
    readonly startScratch: () => boolean;
    readonly openPicker: () => void;
  },
): void {
  if (action !== FORK_TRAY_NEW_THREAD_ACTION) return;
  if (!handlers.startScratch()) {
    handlers.openPicker();
  }
}
