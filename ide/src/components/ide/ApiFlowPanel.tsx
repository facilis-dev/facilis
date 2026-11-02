// The API Flow sidebar (SPEC §10.2, §12 Phase 3): the project's routes, the tables their
// metadata touches and the edges between them, read from the dev-only `/_openapi.json`
// facade through the preview proxy.
//
// Read-only like the Entity Explorer: the revision poll (SPEC §6.6) refetches the graph
// when the project changes and a node click jumps to the route's file. The transport is
// throw-free, so an unreachable or booting project renders a state instead of taking the
// editor down. All strings go through t() and every colour is a role token (D-043/D-044).

import { useEffect, useMemo, useState } from "react";
import RefreshCw from "~icons/lucide/refresh-cw";
import Workflow from "~icons/lucide/workflow";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { fetchApiFlow, type ApiFlowResult } from "@/facilis/api-flow-client";
import { buildApiFlowGraph, type RouteNodeData } from "@/facilis/api-flow-model";
import { fetchRevision } from "@/facilis/manifest-client";
import type { IdeController, IdeSnapshot } from "@/vv/controller";
import { previewSrcFor } from "@/vv/preview-url";
import { ApiFlowContent } from "./ApiFlowContent";
import { useIde } from "./useIde";

/** The preview-proxy base for the running project, like DataExplorerPanel's previewBase. */
function previewBase(controller: IdeController, snapshot: IdeSnapshot): string | null {
  const tab =
    snapshot.previewTabs.find((entry) => entry.id === snapshot.activePreviewId) ??
    snapshot.previewTabs.find((entry) => entry.port !== null);
  if (tab === undefined || tab.port === null) return null;
  return previewSrcFor(controller.bridge, tab);
}

export function ApiFlowPanel() {
  const { c, snap } = useIde();
  const base = previewBase(c, snap);
  const root = c.activeFolder?.rootPath ?? null;
  const [result, setResult] = useState<ApiFlowResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const graph = useMemo(() => (result?.ok ? buildApiFlowGraph(result.data) : null), [result]);

  // Load whenever the project becomes reachable or the user asks for a refresh.
  useEffect(() => {
    if (base === null) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetchApiFlow(base, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      setResult(next);
      setLoading(false);
    });
    return () => controller.abort();
  }, [base, nonce]);

  // SPEC §6.6: the 60-byte revision poll refetches only when the project changed, and
  // only while the tab is visible.
  useEffect(() => {
    if (base === null) return;
    let last: string | null = null;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      const revision = await fetchRevision(base);
      if (cancelled || !revision.ok) return;
      if (last !== null && revision.revision !== last) setNonce((value) => value + 1);
      last = revision.revision;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [base]);

  const openRoute = (data: RouteNodeData) => {
    if (root !== null && data.sourceFile !== null) {
      void c.openEntry(root + "/" + data.sourceFile);
    }
  };
  const openTable = () => {
    if (root !== null) void c.openEntry(root + "/db/schema.ts");
  };
  const refresh = () => setNonce((value) => value + 1);

  return (
    <aside
      data-testid="api-flow-panel"
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      aria-label={t("apiFlow.title")}
    >
      <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Workflow className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("apiFlow.title")}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("apiFlow.refresh")}
          title={t("apiFlow.refresh")}
          disabled={base === null || loading}
          onClick={refresh}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {base === null ? (
          <Empty title={t("apiFlow.unreachable")} body={t("apiFlow.unreachableHint")} />
        ) : result === null && loading ? (
          <p className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            {t("apiFlow.loading")}
          </p>
        ) : result !== null && !result.ok ? (
          <div className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <p className="font-medium text-destructive">
              {t("apiFlow.error", { error: result.error })}
            </p>
            <Button variant="ghost" size="xs" className="mt-1" onClick={refresh}>
              {t("apiFlow.retry")}
            </Button>
          </div>
        ) : graph !== null && graph.stats.routes === 0 ? (
          <Empty
            title={t("apiFlow.empty")}
            body={graph.openapiUnavailable ? t("apiFlow.openapiDisabled") : t("apiFlow.emptyHint")}
          />
        ) : graph !== null ? (
          <ApiFlowContent
            graph={graph}
            onOpenRoute={openRoute}
            onOpenTable={openTable}
            linksDisabled={root === null}
          />
        ) : null}
      </div>
    </aside>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <Workflow className="size-5 text-muted-foreground" />
      <p className="text-xs font-medium">{title}</p>
      <p className="text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}
