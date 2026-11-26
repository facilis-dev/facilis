// The sources the analyzer already read for this snapshot (D-219, #187/#188), split from the
// panel to keep it under the 300-line source limit. loadProjectSources is cached per controller
// snapshot, so the drawer's code previews never re-read files one node at a time.

import { useEffect, useState } from "react";
import type { Analysis } from "@facilis.dev/analyze";
import { loadProjectSources } from "@/facilis/analyze-client";
import type { IdeController } from "@/vv/controller";

export function useProjectGraphSources(
  controller: IdeController,
  analysis: Analysis | null,
): ReadonlyMap<string, string> {
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    // Drop the previous project's map first: the keys are project-relative, so a stale
    // `src/app.tsx` would otherwise render the other project's source while this one loads.
    setSources(new Map());
    if (analysis === null) return;
    let cancelled = false;
    void loadProjectSources(controller)
      .then((loaded) => {
        if (!cancelled && loaded.ok) setSources(loaded.files);
      })
      .catch(() => {
        // A transient bridge failure leaves the snippets empty; the next analysis retries.
      });
    return () => {
      cancelled = true;
    };
  }, [controller, analysis]);
  return sources;
}
