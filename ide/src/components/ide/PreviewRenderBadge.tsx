// The preview's render-mode badge (issue #85): a small overlay chip saying whether the
// active preview document was served as prerendered HTML or the SPA shell. It fetches
// the document through the same-origin preview URL (the dev-base pattern) so the SW
// routes it to this boot's kernel; the marker header / state island decide the mode.
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { renderModeOf, type PreviewRenderMode } from "@/facilis/prerender-response";
import type { PreviewTab } from "@/vv/controller";
import { useIde } from "./useIde";
import { usePrerenderRun } from "./usePrerenderRun";

export function PreviewRenderBadge({ tab }: { tab: PreviewTab }) {
  const { c } = useIde();
  const run = usePrerenderRun();
  const [mode, setMode] = useState<PreviewRenderMode | null>(null);
  // A settled build changes the served document: refetch once it lands.
  const runVersion = run === null ? 0 : run.startedAt + (run.durationMs ?? 0);

  useEffect(() => {
    if (tab.port === null) {
      setMode(null);
      return;
    }
    const url = c.bridge.sameOriginPreviewUrl(tab.port, tab.path === "" ? "/" : tab.path);
    const ac = new AbortController();
    void fetch(url, { headers: { Accept: "text/html" }, signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) {
          setMode(null);
          return;
        }
        setMode(renderModeOf(res.headers, await res.text()));
      })
      .catch(() => {
        if (!ac.signal.aborted) setMode(null);
      });
    return () => {
      ac.abort();
    };
  }, [c, tab.id, tab.port, tab.path, tab.nonce, runVersion]);

  if (mode === null) return null;
  const prerendered = mode === "prerender";
  return (
    <span
      data-testid="preview-render-badge"
      title={t(prerendered ? "prerender.badge.prerenderedHint" : "prerender.badge.shellHint")}
      className={cn(
        "absolute right-2 top-2 z-10 rounded border px-1.5 py-0.5 text-[10px]",
        prerendered
          ? "border-success/40 bg-success/10 text-success"
          : "border-border bg-background/80 text-muted-foreground",
      )}
    >
      {t(prerendered ? "prerender.badge.prerendered" : "prerender.badge.shell")}
    </span>
  );
}
