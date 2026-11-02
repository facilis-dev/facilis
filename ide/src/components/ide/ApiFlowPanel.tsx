// The API Flow (SPEC §10.2, §12 Phase 3; D-085/D-087): the project's routes, the tables
// their metadata touches and the client pages that call them. It lives in the editor area
// as a synthetic tab, so the graph gets the center width instead of the sidebar's.
//
// Read-only: the OpenAPI document is fetched through the preview proxy, the client files
// are read from the VFS and scanned for /api references, and the revision poll (SPEC §6.6)
// refetches when the project changes. Every read is throw-free, so an unreachable project
// renders a state instead of taking the editor down.

import { useEffect, useMemo, useState } from "react";
import Workflow from "~icons/lucide/workflow";
import List from "~icons/lucide/list";
import Network from "~icons/lucide/network";
import RefreshCw from "~icons/lucide/refresh-cw";
import Maximize2 from "~icons/lucide/maximize-2";
import Minimize2 from "~icons/lucide/minimize-2";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { fetchApiFlow, type ApiFlowResult } from "@/facilis/api-flow-client";
import { scanApiConsumers, type ApiFlowConsumers } from "@/facilis/api-flow-consumers";
import {
  buildApiFlowGraph,
  type ApiFlowSelection,
  type ApiPageNode,
  type ApiRouteNode,
} from "@/facilis/api-flow-model";
import { fetchRevision } from "@/facilis/manifest-client";
import type { IdeController, IdeSnapshot } from "@/vv/controller";
import { previewSrcFor } from "@/vv/preview-url";
import { ApiFlowBody } from "./ApiFlowBody";
import { ApiFlowInspector } from "./ApiFlowInspector";
import { useIde } from "./useIde";

const MAX_SCAN_FILES = 300;
const MAX_SCAN_CHARS = 300_000;
const MAX_FILE_CHARS = 80_000;

/** The preview-proxy base for the running project, like DataExplorerPanel's previewBase. */
function previewBase(controller: IdeController, snapshot: IdeSnapshot): string | null {
  const tab =
    snapshot.previewTabs.find((entry) => entry.id === snapshot.activePreviewId) ??
    snapshot.previewTabs.find((entry) => entry.port !== null);
  if (tab === undefined || tab.port === null) return null;
  return previewSrcFor(controller.bridge, tab);
}

export function ApiFlowPanel({ placement = "center" }: { placement?: "center" | "sidebar" }) {
  const { c, snap } = useIde();
  const base = previewBase(c, snap);
  const root = c.activeFolder?.rootPath ?? null;
  const [result, setResult] = useState<ApiFlowResult | null>(null);
  const [consumers, setConsumers] = useState<ApiFlowConsumers | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ApiFlowSelection | null>(null);

  // Load the OpenAPI document whenever the project becomes reachable or the user refreshes.
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

  // Scan the project's client files for the routes they call. Bounded and sequential: the
  // kernel read is cheap but there is no point in reading a 300-file project for a panel.
  useEffect(() => {
    if (result === null || !result.ok || root === null) {
      setConsumers(null);
      return;
    }
    const operations = result.data.operations;
    let cancelled = false;
    const files = snap.files.filter(
      (abs) => abs.startsWith(root + "/src/") && /\.(?:ts|tsx|js|jsx|mjs)$/.test(abs),
    );
    void (async () => {
      const sources: { path: string; text: string }[] = [];
      let budget = MAX_SCAN_CHARS;
      for (const abs of files.slice(0, MAX_SCAN_FILES)) {
        // oxlint-disable-next-line no-await-in-loop -- kernel reads are one-in-flight anyway
        const text = await c.readFileText(abs);
        if (text.length > MAX_FILE_CHARS) continue;
        budget -= text.length;
        if (budget < 0) break;
        sources.push({ path: abs.slice(root.length + 1), text });
      }
      if (cancelled) return;
      setConsumers(scanApiConsumers(sources, operations));
    })();
    return () => {
      cancelled = true;
    };
  }, [c, root, result, nonce, snap.files]);

  // SPEC §6.6: the 60-byte revision poll refetches only when the project changed.
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

  const graph = useMemo(() => {
    if (result === null || !result.ok) return null;
    const needle = query.trim().toLowerCase();
    const operations =
      needle.length === 0
        ? result.data.operations
        : result.data.operations.filter(
            (operation) =>
              operation.path.toLowerCase().includes(needle) ||
              operation.method.toLowerCase().includes(needle),
          );
    return buildApiFlowGraph({ operations, warnings: result.data.warnings }, consumers);
  }, [result, consumers, query]);

  // A refresh can remove the selected node; keep the inspector coherent.
  useEffect(() => {
    if (graph === null || selected === null) return;
    const exists =
      selected.kind === "page"
        ? graph.pages.some((node) => node.id === selected.id)
        : selected.kind === "route"
          ? graph.routes.some((node) => node.id === selected.id)
          : graph.tables.some((node) => node.id === selected.id);
    if (!exists) setSelected(null);
  }, [graph, selected]);

  const openPath = (path: string) => {
    if (root === null) return;
    void c.openEntry(root + "/" + path);
  };
  const openRoute = (node: ApiRouteNode) => {
    if (node.data.sourceFile !== null) openPath(node.data.sourceFile);
  };
  const openPage = (node: ApiPageNode) => openPath(node.data.path);
  const openTable = () => {
    if (root !== null) void c.openEntry(root + "/db/schema.ts");
  };
  const refresh = () => setNonce((value) => value + 1);
  const shell = placement === "center" ? "bg-editor" : "bg-sidebar";
  const linksDisabled = root === null;
  // A graph needs width: one click hides the sidebar and the preview (and restores them
  // when both are already hidden). In a narrow window this is the difference between the
  // node labels and a thumbnail.
  const focused = snap.sidebarCollapsed && snap.previewCollapsed && snap.panelCollapsed;
  const toggleFocus = () => {
    c.toggleSidebar(focused);
    c.togglePreview(focused);
    c.togglePanel(focused);
  };

  return (
    <section
      data-testid="api-flow-panel"
      className={"flex h-full min-h-0 flex-col " + shell}
      aria-label={t("apiFlow.title")}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Workflow className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("apiFlow.tabTitle")}</span>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("apiFlow.search")}
          aria-label={t("apiFlow.search")}
          className="mx-1 h-6 min-w-32 flex-1 rounded border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-0.5">
          <Button
            variant={view === "graph" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "graph"}
            onClick={() => setView("graph")}
          >
            <Network />
            {t("apiFlow.viewGraph")}
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List />
            {t("apiFlow.viewList")}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={focused ? t("apiFlow.unfocus") : t("apiFlow.focus")}
          title={focused ? t("apiFlow.unfocus") : t("apiFlow.focus")}
          aria-pressed={focused}
          onClick={toggleFocus}
        >
          {focused ? <Minimize2 /> : <Maximize2 />}
        </Button>
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
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ApiFlowBody
            base={base}
            result={result}
            loading={loading}
            graph={graph}
            query={query}
            view={view}
            selected={selected}
            linksDisabled={linksDisabled}
            onRetry={refresh}
            onSelect={setSelected}
            onOpenRoute={openRoute}
            onOpenPage={openPage}
            onOpenTable={openTable}
          />
        </div>
        {graph !== null && selected !== null && (
          <ApiFlowInspector
            graph={graph}
            selection={selected}
            linksDisabled={linksDisabled}
            onClose={() => setSelected(null)}
            onOpenRoute={openRoute}
            onOpenPage={openPage}
            onOpenTable={openTable}
          />
        )}
      </div>
    </section>
  );
}
