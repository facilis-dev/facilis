// The Release Preview sidebar (SPEC §11.3, D-086): four lenses over one engine — the three
// git ones from this panel and the code↔live card read from D-083's dev endpoint.
//
// The panel is mounted only while its activity view is shown, so the lazy git import and
// the snapshot reads happen on first open and on refresh. Every read is throw-free and a
// failure renders as state inside the panel instead of taking the editor down.

import { useEffect, useMemo, useState } from "react";
import GitCompare from "~icons/lucide/git-compare";
import RefreshCw from "~icons/lucide/refresh-cw";
import { Button } from "@/components/ui/button";
import { rt } from "@/facilis/release-i18n";
import { fetchDataExplorer } from "@/facilis/data-explorer-client";
import { loadReleaseLens, type ReleaseLensLoad } from "@/facilis/release-preview-load";
import {
  buildReleaseView,
  EMPTY_REF_INVENTORY,
  lensPresets,
  type ReleaseLensId,
} from "@/facilis/release-preview-model";
import { devBase } from "@/facilis/dev-base";
import { ReleasePreviewContent, type CodeLiveState } from "./ReleasePreviewContent";
import { useIde } from "./useIde";

export function ReleasePreviewPanel() {
  const { c, snap } = useIde();
  const base = devBase(c.bridge, snap);
  const root = c.activeFolder?.rootPath ?? null;
  const [lens, setLens] = useState<ReleaseLensId>("working");
  const [load, setLoad] = useState<ReleaseLensLoad | null>(null);
  const [codeLive, setCodeLive] = useState<CodeLiveState>({ status: "loading" });
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const view = useMemo(() => (load?.preview ? buildReleaseView(load.preview) : null), [load]);
  const refs = load?.refs ?? EMPTY_REF_INVENTORY;
  const presets = useMemo(() => lensPresets(refs), [refs]);

  // One lens load per selection/refresh. The git module is lazy, so opening this view is
  // the first time the repository is read; the panel is mounted only when active.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoad(null);
    void loadReleaseLens(c, { lens, base }).then((next) => {
      if (cancelled) return;
      setLoad(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [c, base, lens, nonce]);

  // The code↔live card reuses the Entity Explorer's dev-only endpoint, throw-free.
  useEffect(() => {
    if (base === null) {
      setCodeLive({ status: "unreachable" });
      return;
    }
    const controller = new AbortController();
    setCodeLive({ status: "loading" });
    void fetchDataExplorer(base, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setCodeLive(
        result.ok
          ? { status: "ready", drift: result.data.drift.length }
          : { status: "unreachable" },
      );
    });
    return () => controller.abort();
  }, [base, nonce]);

  const openSchema = (): void => {
    if (root !== null) void c.openEntry(root + "/db/schema.ts");
  };
  const openFile = (sourceFile: string): void => {
    if (root !== null) void c.openEntry(root + "/" + sourceFile);
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      aria-label={rt("releasePreview.title")}
      data-testid="release-preview-panel"
    >
      <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <GitCompare className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{rt("releasePreview.title")}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={rt("releasePreview.refresh")}
          title={rt("releasePreview.refresh")}
          disabled={loading || root === null}
          onClick={() => setNonce((value) => value + 1)}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ReleasePreviewContent
          lens={lens}
          presets={presets}
          load={load}
          view={view}
          loading={loading}
          codeLive={codeLive}
          linksDisabled={root === null}
          onSelectLens={setLens}
          onOpenSchema={openSchema}
          onOpenFile={openFile}
          onRetry={() => setNonce((value) => value + 1)}
        />
      </div>
    </aside>
  );
}
