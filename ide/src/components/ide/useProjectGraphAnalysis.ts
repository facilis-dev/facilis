// Analysis lifecycle for the project graph (D-126): load the analyzer snapshot on mount, on
// refresh and whenever the active project changes. The index gate is one-shot: after it opens,
// an edit/import does not re-run the analysis per keystroke. Split from the panel so that file
// stays under the 300-line limit.

import { useCallback, useEffect, useState } from "react";
import { loadProjectAnalysis } from "@/facilis/analyze-client";
import type { ProjectAnalysisResult } from "@/facilis/project-analysis";
import { errText } from "@/vv/errors";
import type { IdeController } from "@/vv/controller";

export interface ProjectGraphAnalysis {
  readonly result: ProjectAnalysisResult | null;
  readonly loading: boolean;
  readonly refresh: () => void;
}

export function useProjectGraphAnalysis(
  c: IdeController,
  root: string | null,
  indexReady: boolean,
): ProjectGraphAnalysis {
  const [result, setResult] = useState<ProjectAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
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
  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { result, loading, refresh };
}
