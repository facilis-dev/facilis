// The project-graph analysis lifecycle, split from ProjectGraphPanel (issue #57) so the panel
// stays a composition root under the source limit. Owns the analyzer result, the refresh nonce,
// the loading/error flags and the cached source snippets. Pure wiring of the existing clients:
// nothing here writes to the project, and the index gate keeps a cold boot from analyzing empty.

import { useCallback, useEffect, useState } from "react";
import { loadProjectAnalysis, loadProjectSources } from "@/facilis/analyze-client";
import type { ProjectAnalysisResult } from "@/facilis/project-analysis";
import type { Analysis } from "@facilis.dev/analyze";
import { errText } from "@/vv/errors";
import type { IdeController } from "@/vv/controller";

export interface ProjectGraphAnalysisState {
  readonly analysis: Analysis | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly sources: ReadonlyMap<string, string>;
  readonly refresh: () => void;
}

export function useProjectGraphAnalysis(
  c: IdeController,
  root: string | null,
  indexReady: boolean,
): ProjectGraphAnalysisState {
  const [result, setResult] = useState<ProjectAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  // The sources the analyzer already read for this snapshot, so code previews never re-read
  // files one node at a time (loadProjectSources is cached per controller snapshot).
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());

  // On mount, on refresh, and whenever the active project changes. The index gate is one-shot:
  // after it opens, a later edit/import does not re-run the analysis per keystroke.
  useEffect(() => {
    if (root === null) {
      setResult(null);
      setLoading(false);
      return;
    }
    if (!indexReady) {
      // Still indexing: analyzing now would report an empty project (missing-config error).
      setResult(null);
      setLoading(true);
      return;
    }
    let cancelled = false;
    setResult(null);
    setLoading(true);
    void loadProjectAnalysis(c)
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({ ok: false, error: errText(error) });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [c, root, nonce, indexReady]);

  const analysis = result !== null && result.ok ? result.analysis : null;
  useEffect(() => {
    // Drop the previous project's map first: the keys are project-relative, so a stale
    // src/app.tsx would otherwise render the other project's source while this one loads.
    setSources(new Map());
    if (analysis === null) return;
    let cancelled = false;
    void loadProjectSources(c)
      .then((loaded) => {
        if (!cancelled && loaded.ok) setSources(loaded.files);
      })
      .catch(() => {
        // A transient bridge failure leaves the snippets empty; the next analysis retries.
      });
    return () => {
      cancelled = true;
    };
  }, [c, analysis]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const error = result !== null && !result.ok ? result.error : null;
  return { analysis, loading, error, sources, refresh };
}
