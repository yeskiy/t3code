import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useContext, useState } from "react";

import { forkTranscriptBlockText } from "./transcriptEditRpc";

export interface FullTextTarget {
  readonly threadRef: ScopedThreadRef;
  readonly baseKey: string;
  readonly uuid: string;
  readonly index: number | null;
  readonly part: "block" | "raw";
}

// Holds the full text of a truncated block or raw entry after "Show all".
export const useForkTranscriptFullText = (target: FullTextTarget) => {
  const registry = useContext(RegistryContext);
  const [full, setFull] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const showAll = () => {
    setBusy(true);
    void runAtomCommand(
      registry,
      forkTranscriptBlockText,
      {
        environmentId: target.threadRef.environmentId,
        input: {
          threadId: target.threadRef.threadId,
          baseKey: target.baseKey,
          uuid: target.uuid,
          index: target.index,
          part: target.part,
        },
      },
      { reportFailure: false, reportDefect: false },
    )
      .then((result) => {
        if (result._tag === "Success") setFull(result.value);
        setFailed(result._tag !== "Success");
      })
      .finally(() => setBusy(false));
  };
  return { full, failed, busy, showAll } as const;
};
