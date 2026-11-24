/* oxlint-disable t3code/no-untranslated-copy -- fork-only English copy */
import { useForkArtifactsEnabled } from "./forkArtifactsSetting";

export const FORK_THREAD_DETAILS_ITEMS = [
  { id: "artifacts", label: "Artifacts", defaultVisible: true },
] as const;

export function filterForkThreadDetailsItems<T extends { readonly id: string }>(
  items: readonly T[],
  artifactsEnabled: boolean,
): readonly T[] {
  return artifactsEnabled ? items : items.filter((item) => item.id !== "artifacts");
}

export function useForkThreadDetailsItems<T extends { readonly id: string }>(
  items: readonly T[],
): readonly T[] {
  const [artifactsEnabled] = useForkArtifactsEnabled();
  return filterForkThreadDetailsItems(items, artifactsEnabled);
}
