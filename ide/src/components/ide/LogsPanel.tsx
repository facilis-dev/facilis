// The Logs sidebar (D-119): read-only insight into the framework's JSONL log files.
//
// SECURITY: the framework has no log HTTP endpoint, not even dev-only, because a log
// endpoint would expose request paths, user ids, session hashes, client IPs and stack
// traces. The files live in <projectRoot>/.facilis/logs and are read through the kernel
// VFS (facilis/logs-client.ts); this panel never fetches anything.
//
// Every string is a t() key and every colour a semantic role (D-043/D-044). The panel
// is read-only by design: opening a file in the editor is the only write-adjacent action,
// and Monaco owns the bytes from there. Rows/filters/states live in LogsPanelParts.tsx.

import { useEffect, useMemo, useState } from "react";
import ScrollText from "~icons/lucide/scroll-text";
import FileText from "~icons/lucide/file-text";
import RefreshCw from "~icons/lucide/refresh-cw";
import ExternalLink from "~icons/lucide/external-link";
import Pause from "~icons/lucide/pause";
import Play from "~icons/lucide/play";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/i18n";
import { LOG_TAIL_BYTES, loadLogs, type LogsData, type LogsVfs } from "@/facilis/logs-client";
import {
  LOG_KINDS,
  LOG_LEVELS,
  filterLogEntries,
  formatLogSize,
  logsDirFor,
  newestFirst,
  type LogFilter,
  type LogKind,
  type LogLevel,
} from "@/facilis/logs-model";
import { FilterChips, LogRow, LogsEmptyState, LogsErrorState } from "./LogsPanelParts";
import { useIde } from "./useIde";

/** The framework appends as requests finish; 2 s keeps a tail feeling live. */
const POLL_MS = 2000;

const KIND_LABELS: Record<LogKind, MessageKey> = {
  access: "logs.kind.access",
  audit: "logs.kind.audit",
  error: "logs.kind.error",
  app: "logs.kind.app",
};

const LEVEL_LABELS: Record<LogLevel, MessageKey> = {
  debug: "logs.level.debug",
  info: "logs.level.info",
  warn: "logs.level.warn",
  error: "logs.level.error",
};

export function LogsPanel() {
  const { c, snap } = useIde();
  const root = c.activeFolder?.rootPath ?? null;
  // The same kernel RPCs IdeController.readdir/readFileText/pathInfo wrap. The stat call
  // is used for the per-file size, which those controller helpers do not expose.
  const vfs = useMemo<LogsVfs>(
    () => ({ request: (type, payload) => c.bridge.request(type, payload) }),
    [c],
  );
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [kind, setKind] = useState<LogKind | "all">("all");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [text, setText] = useState("");
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<LogsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // One load per project / selected file / refresh tick. Home keeps the workspace mounted,
  // so skip the read entirely while it is the visible view.
  useEffect(() => {
    if (root === null || snap.view !== "workspace") {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await loadLogs(vfs, root, { selectedName });
        if (cancelled) return;
        if (result.ok) {
          setData(result.data);
          setError(null);
        } else {
          setData(null);
          setError(result.error);
        }
      } catch (failure) {
        if (cancelled) return;
        setData(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root, selectedName, tick, vfs, snap.view]);

  useEffect(() => {
    if (!auto || root === null || snap.view !== "workspace") return;
    const timer = setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [auto, root, snap.view]);

  const filter = useMemo<LogFilter>(() => ({ kind, level, text }), [kind, level, text]);
  const rows = useMemo(
    () => (data === null ? [] : newestFirst(filterLogEntries(data.entries, filter))),
    [data, filter],
  );
  const selected = data?.selected ?? null;
  const logsDir = data?.dir ?? (root === null ? "" : logsDirFor(root));

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      aria-label={t("logs.title")}
    >
      <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <ScrollText className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("logs.title")}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant={auto ? "secondary" : "ghost"}
            size="icon-sm"
            aria-pressed={auto}
            aria-label={t("logs.autoRefresh")}
            title={t("logs.autoRefresh")}
            onClick={() => setAuto((value) => !value)}
          >
            {auto ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("logs.refresh")}
            title={t("logs.refresh")}
            disabled={root === null}
            onClick={() => setTick((value) => value + 1)}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("logs.openInEditor")}
            title={t("logs.openInEditor")}
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) void c.openEntry(selected.path);
            }}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      {root === null ? (
        <LogsEmptyState body={t("logs.noProject")} />
      ) : (
        <>
          {data !== null && data.files.length > 0 ? (
            <div className="shrink-0 border-b">
              <p className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("logs.files")}
              </p>
              <ul className="max-h-40 overflow-y-auto px-1 pb-1">
                {data.files.map((file) => {
                  const active = selected?.name === file.name;
                  return (
                    <li key={file.name}>
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => setSelectedName(file.name)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px]",
                          active
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                        )}
                      >
                        <FileText className="size-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-mono">{file.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {formatLogSize(file.size) || t("logs.sizeUnknown")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="shrink-0 space-y-1 border-b px-2 py-1.5">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("logs.filterText")}
              aria-label={t("logs.filterText")}
              className="h-7 bg-transparent text-xs"
            />
            <FilterChips
              label={t("logs.filterKind")}
              value={kind}
              options={LOG_KINDS}
              labels={KIND_LABELS}
              onChange={setKind}
            />
            <FilterChips
              label={t("logs.filterLevel")}
              value={level}
              options={LOG_LEVELS}
              labels={LEVEL_LABELS}
              onChange={setLevel}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
            {error !== null ? (
              <LogsErrorState error={error} onRetry={() => setTick((value) => value + 1)} />
            ) : data === null ? (
              <p className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin" />
                {t("logs.loading")}
              </p>
            ) : data.files.length === 0 ? (
              <LogsEmptyState
                title={t("logs.empty")}
                body={t("logs.emptyHint", { path: logsDir })}
              />
            ) : selected === null ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">{t("logs.selectFile")}</p>
            ) : rows.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">
                {data.entries.length === 0 ? t("logs.noRows") : t("logs.emptyFiltered")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {rows.map((entry) => (
                  // Keyed by request id, not line number: the tail window slides as rows
                  // are appended, and a line-keyed row would collapse on every poll.
                  <LogRow
                    key={
                      selected.name +
                      ":" +
                      (entry.requestId ?? "line:" + entry.line + ":" + entry.ts)
                    }
                    entry={entry}
                  />
                ))}
              </ul>
            )}
          </div>

          {data !== null && selected !== null ? (
            <div className="shrink-0 space-y-0.5 border-t px-2 py-1 text-[10px] text-muted-foreground">
              <p>{t("logs.count", { shown: rows.length, total: data.entries.length })}</p>
              {data.truncated ? (
                <p className="text-warning">
                  {t("logs.truncated", { kib: Math.round(LOG_TAIL_BYTES / 1024) })}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
