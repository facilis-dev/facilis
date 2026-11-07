// The Data Explorer's SQL query console (D-097): an editor-area tab that runs one query
// against the project's dev-only endpoint and can turn that query into a reusable
// `defineView` in project code.
//
// Everything reaches the kernel through devBase()/devEndpointUrl(), so the console works
// while the preview is opened in a separate browser tab (the URL carries this boot's
// kernel token); writes go through the kernel bridge, never directly to a file system.

import { useEffect, useRef, useState } from "react";
import Play from "~icons/lucide/play";
import Plus from "~icons/lucide/plus";
import RefreshCw from "~icons/lucide/refresh-cw";
import SquareTerminal from "~icons/lucide/square-terminal";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { devBase, devEndpointUrl } from "@/facilis/dev-base";
import { runDevQuery, type DevQueryColumn, type DevQueryResult } from "@/facilis/dev-query-client";
import { fetchManifestAt, MANIFEST_PATH, readDeclaredPermissions } from "@/facilis/manifest-client";
import { DataQueryCreateViewDialog } from "./DataQueryCreateViewDialog";
import { DataQueryResults } from "./DataQueryResults";
import { useIde } from "./useIde";

/** The config-section manifest URL, keeping the preview's kernel token. */
function manifestConfigUrl(base: string): string {
  const url = devEndpointUrl(base, MANIFEST_PATH);
  return url + (url.includes("?") ? "&" : "?") + "sections=config";
}

export function DataQueryPanel() {
  const { c, snap } = useIde();
  const base = devBase(c.bridge, snap);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<DevQueryResult | null>(null);
  // The text the displayed result belongs to: the create-view flow must generate the
  // source for what actually ran, even if the editor was edited afterwards.
  const [executedSql, setExecutedSql] = useState("");
  const [running, setRunning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight query when the tab closes; the response has nowhere to go.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A different preview (or none) invalidates the rows shown for the previous one.
  useEffect(() => {
    setResult(null);
  }, [base]);

  // The create-view dialog offers only permissions declared in facilis.config.ts. Refetch
  // when the dialog opens so a config edit shows up without reopening the tab; an
  // unreachable manifest leaves the list empty, i.e. the invoker default only.
  useEffect(() => {
    if (base === null) {
      setPermissions([]);
      return;
    }
    if (!createOpen) return;
    let cancelled = false;
    void fetchManifestAt(manifestConfigUrl(base)).then((manifest) => {
      if (cancelled) return;
      setPermissions(manifest.ok ? readDeclaredPermissions(manifest.envelope.manifest) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [base, createOpen]);

  const run = async () => {
    if (base === null || sql.trim().length === 0 || running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const text = sql;
    setRunning(true);
    const next = await runDevQuery(base, text, { signal: controller.signal });
    if (controller.signal.aborted) return;
    setResult(next);
    setExecutedSql(text);
    setRunning(false);
  };

  const columns: readonly DevQueryColumn[] =
    result !== null && result.ok ? result.data.columns : [];
  const canCreate = base !== null && result !== null && result.ok && columns.length > 0;
  const canRun = base !== null && sql.trim().length > 0 && !running;

  return (
    <section
      data-testid="data-query-panel"
      aria-label={t("dataQuery.title")}
      className="flex h-full min-h-0 flex-col bg-editor"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <SquareTerminal className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("dataQuery.title")}</span>
          <span className="hidden text-[10px] font-normal text-muted-foreground sm:inline">
            {t("dataQuery.runShortcut")}
          </span>
        </div>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          {running && (
            <>
              <RefreshCw className="size-3 animate-spin" />
              {t("dataQuery.running")}
            </>
          )}
        </span>
        <Button
          variant="secondary"
          size="sm"
          data-testid="data-query-run"
          disabled={!canRun}
          onClick={() => void run()}
        >
          <Play />
          {t("dataQuery.run")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="data-query-create-view"
          disabled={!canCreate}
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          {t("dataQuery.createView")}
        </Button>
      </div>

      {base !== null && result === null && (
        <p className="shrink-0 border-b bg-warning/5 px-2 py-1 text-[10px] text-warning">
          {t("dataQuery.rlsWarning")}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <textarea
          data-testid="data-query-editor"
          aria-label={t("dataQuery.editorLabel")}
          value={sql}
          spellCheck={false}
          placeholder={t("dataQuery.placeholder")}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void run();
            }
          }}
          className="h-36 shrink-0 resize-y border-b bg-editor px-3 py-2 font-mono text-xs text-editor-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-inset focus:ring-ring"
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          {base === null ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <SquareTerminal className="size-5 text-muted-foreground" />
              <p className="text-xs font-medium">{t("dataQuery.noBase")}</p>
              <p className="max-w-sm text-[11px] text-muted-foreground">
                {t("dataQuery.noBaseHint")}
              </p>
            </div>
          ) : result !== null ? (
            <DataQueryResults result={result} onRetry={() => void run()} />
          ) : running ? (
            <p className="flex items-center gap-1.5 px-3 py-3 text-[11px] text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin" />
              {t("dataQuery.running")}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-1 px-3 py-10 text-center">
              <p className="text-xs font-medium">{t("dataQuery.idle")}</p>
              <p className="max-w-sm text-[11px] text-muted-foreground">
                {t("dataQuery.idleHint")}
              </p>
            </div>
          )}
        </div>
      </div>

      <DataQueryCreateViewDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        base={base}
        columns={columns}
        query={executedSql}
        permissions={permissions}
      />
    </section>
  );
}
