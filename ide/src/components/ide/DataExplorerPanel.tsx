// The Data Explorer sidebar (SPEC §11.1, D-083): the live schema of the running project
// next to the schema `db/schema.ts` declares, with the typed drift between them.
//
// It only reads: fetching goes through the dev-only `/__facilis/dev/schema` endpoint
// (via the preview proxy), never straight to PGlite. All strings go through t() and every
// colour is a role token (D-043/D-044).

import { useEffect, useMemo, useState } from "react";
import Database from "~icons/lucide/database";
import RefreshCw from "~icons/lucide/refresh-cw";
import SquareTerminal from "~icons/lucide/square-terminal";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { fetchDataExplorer, type DataExplorerResult } from "@/facilis/data-explorer-client";
import { buildExplorerView, type ExplorerRouteUsage } from "@/facilis/data-explorer-model";
import { devBase } from "@/facilis/dev-base";
import { fetchRevision } from "@/facilis/manifest-client";
import { DataExplorerContent } from "./DataExplorerContent";
import { useIde } from "./useIde";

export function DataExplorerPanel() {
  const { c, snap } = useIde();
  const base = devBase(c.bridge, snap);
  const root = c.activeFolder?.rootPath ?? null;
  const [result, setResult] = useState<DataExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const view = useMemo(() => (result?.ok ? buildExplorerView(result.data) : null), [result]);

  // Load whenever the project becomes reachable or the user asks for a refresh.
  useEffect(() => {
    if (base === null) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetchDataExplorer(base, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      setResult(next);
      setLoading(false);
    });
    return () => controller.abort();
  }, [base, nonce]);

  // SPEC §6.6: the revision poll is 60 bytes, so a schema refetch on change is cheap.
  useEffect(() => {
    if (base === null) return;
    let last: string | null = null;
    let cancelled = false;
    const poll = async () => {
      const revision = await fetchRevision(base);
      if (cancelled || !revision.ok) return;
      if (last !== null && revision.revision !== last) setNonce((value) => value + 1);
      last = revision.revision;
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base]);

  const openTable = () => {
    if (root !== null) void c.openEntry(root + "/db/schema.ts");
  };
  const openRoute = (usage: ExplorerRouteUsage) => {
    if (root !== null && usage.sourceFile !== null) {
      void c.openEntry(root + "/" + usage.sourceFile);
    }
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      aria-label={t("dataExplorer.title")}
    >
      <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Database className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("dataExplorer.title")}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="data-query-open"
            aria-label={t("dataQuery.open")}
            title={t("dataQuery.open")}
            onClick={() => c.openDataQuery()}
          >
            <SquareTerminal />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("dataExplorer.refresh")}
            title={t("dataExplorer.refresh")}
            disabled={base === null || loading}
            onClick={() => setNonce((value) => value + 1)}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {base === null ? (
          <Empty title={t("dataExplorer.unreachable")} body={t("dataExplorer.unreachableHint")} />
        ) : result === null && loading ? (
          <p className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            {t("dataExplorer.loading")}
          </p>
        ) : result !== null && !result.ok ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <p className="font-medium text-destructive">
              {result.code === "db_unavailable"
                ? t("dataExplorer.dbUnavailable")
                : t("dataExplorer.error", { error: result.error })}
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-1"
              onClick={() => setNonce((value) => value + 1)}
            >
              {t("dataExplorer.retry")}
            </Button>
          </div>
        ) : view !== null ? (
          <DataExplorerContent
            view={view}
            onOpenTable={openTable}
            onOpenRoute={openRoute}
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
      <Database className="size-5 text-muted-foreground" />
      <p className="text-xs font-medium">{title}</p>
      <p className="text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}
