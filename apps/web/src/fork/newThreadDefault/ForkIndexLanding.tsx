import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useAllEnvironmentShellsBootstrapped } from "~/state/entities";
import { decideForkLanding } from "./newThreadDefault.logic";
import { useForkNewThreadDefault } from "./forkNewThreadDefault";

export function ForkIndexLanding({ upstream }: { readonly upstream: ReactNode }) {
  const [setting] = useForkNewThreadDefault();
  const scratch = useScratchProject();
  const environmentsReady = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const router = useRouter();
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const scratchEnvironmentId = scratch.scratchEnvironmentId(null);
  const decision = failed
    ? "upstream"
    : decideForkLanding({ setting, environmentsReady, scratchEnvironmentId });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the No project draft and replaces the index route
  useEffect(() => {
    if (decision !== "scratch" || scratchEnvironmentId === null || startedRef.current) return;
    if (router.state.location.pathname !== "/") return;
    startedRef.current = true;
    void scratch
      .openScratchProject(scratchEnvironmentId)
      .then((project) =>
        project === null
          ? null
          : handleNewThread(scopeProjectRef(project.environmentId, project.id), { replace: true }),
      )
      .then((opened) => {
        if (opened === null) setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [decision, handleNewThread, router, scratch, scratchEnvironmentId]);

  return decision === "upstream" ? upstream : null;
}
