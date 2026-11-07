// The commit-graph tab (D-088): a repository's branches and commits drawn with React Flow
// inside the editor area, so the graph gets the center width instead of the sidebar's.
//
// Read-only and local-only: the session reads the git store on open, and again when the SCM
// snapshot reports that HEAD moved (a commit, a branch switch) or the user refreshes. No
// network, so it behaves the same in an open or a managed build as the SCM panel does.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import GitFork from "~icons/lucide/git-fork";
import GitBranch from "~icons/lucide/git-branch";
import RefreshCw from "~icons/lucide/refresh-cw";
import Maximize2 from "~icons/lucide/maximize-2";
import Minimize2 from "~icons/lucide/minimize-2";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { CommitGraphNode } from "@/facilis/commit-graph-model";
import { CommitGraphSession, type CommitGraphRead } from "@/vv/commit-graph-session";
import { CommitGraphCanvas } from "./CommitGraphCanvas";
import { CommitGraphDetails } from "./CommitGraphDetails";
import { useIde } from "./useIde";

const NOT_A_REPO = "not a git repository";

export function CommitGraphPanel({ root }: { root: string }) {
  const { c, snap } = useIde();
  const scmSnap = useSyncExternalStore(c.scm.subscribe, c.scm.getSnapshot);
  const repo = scmSnap.repos.find((entry) => entry.root === root);
  const session = useMemo(() => new CommitGraphSession(c.bridge), [c]);
  const [read, setRead] = useState<CommitGraphRead | null>(null);
  const [nonce, setNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A commit or a branch switch in the SCM panel must show up here without a refresh, but
  // a status walk must not: the signature only changes when HEAD or its tip commit does.
  const headSignature = (repo?.currentBranch ?? "") + ":" + (repo?.history[0]?.oid ?? "");

  useEffect(() => {
    let cancelled = false;
    setRead(null);
    void session.load(root).then((next) => {
      if (!cancelled) setRead(next);
    });
    return () => {
      cancelled = true;
    };
  }, [session, root, nonce, headSignature]);

  const graph = read !== null && read.ok ? read.graph : null;
  const selected: CommitGraphNode | null =
    graph !== null && selectedId !== null
      ? (graph.nodes.find((node) => node.id === selectedId) ?? null)
      : null;

  // A reload can remove the selected commit; keep the inspector coherent.
  useEffect(() => {
    if (selectedId === null || graph === null) return;
    if (!graph.nodes.some((node) => node.id === selectedId)) setSelectedId(null);
  }, [graph, selectedId]);

  // A graph needs width: one click hides the sidebar and the preview (and restores them
  // when both are already hidden), as the project graph does.
  const focused = snap.sidebarCollapsed && snap.previewCollapsed && snap.panelCollapsed;
  const toggleFocus = () => {
    c.toggleSidebar(focused);
    c.togglePreview(focused);
    c.togglePanel(focused);
  };

  return (
    <section
      data-testid="commit-graph-panel"
      className="flex h-full min-h-0 flex-col bg-editor"
      aria-label={t("commitGraph.title")}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <GitFork className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("commitGraph.title")}</span>
          <span className="min-w-0 truncate text-muted-foreground">{root.split("/").pop()}</span>
        </div>
        {repo?.currentBranch && (
          <span
            className="flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={repo.currentBranch}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{repo.currentBranch}</span>
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={focused ? t("commitGraph.unfocus") : t("commitGraph.focus")}
          title={focused ? t("commitGraph.unfocus") : t("commitGraph.focus")}
          aria-pressed={focused}
          onClick={toggleFocus}
        >
          {focused ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("commitGraph.refresh")}
          title={t("commitGraph.refresh")}
          disabled={read === null}
          onClick={() => setNonce((value) => value + 1)}
        >
          <RefreshCw />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {read === null && (
          <p className="flex items-center gap-1.5 px-3 py-3 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            {t("commitGraph.loading")}
          </p>
        )}
        {read !== null && !read.ok && (
          <div className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <p className="font-medium text-destructive">
              {read.error === NOT_A_REPO
                ? t("commitGraph.notRepo")
                : t("commitGraph.error", { error: read.error })}
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-1"
              onClick={() => setNonce((value) => value + 1)}
            >
              {t("commitGraph.refresh")}
            </Button>
          </div>
        )}
        {graph !== null && graph.stats.commits === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <GitFork className="size-5 text-muted-foreground" />
            <p className="text-xs font-medium">{t("commitGraph.empty")}</p>
            <p className="text-[11px] text-muted-foreground">{t("commitGraph.emptyHint")}</p>
          </div>
        )}
        {graph !== null && graph.stats.commits > 0 && (
          <>
            <div className="min-w-0 flex-1">
              <CommitGraphCanvas graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            {selected !== null && (
              <CommitGraphDetails root={root} node={selected} onClose={() => setSelectedId(null)} />
            )}
          </>
        )}
      </div>

      {graph !== null && graph.stats.commits > 0 && (
        <div className="shrink-0 space-y-1 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
          <p>
            {t("commitGraph.stats", {
              commits: graph.stats.commits,
              branches: graph.stats.branches,
              lanes: graph.stats.lanes,
            })}
          </p>
          <ul className="flex flex-wrap items-center gap-1">
            <li className="font-medium text-foreground">{t("commitGraph.legend")}</li>
            <li className="rounded border px-1">{t("commitGraph.legendCommit")}</li>
            <li className="flex items-center gap-0.5 rounded border px-1">
              <GitBranch className="size-2.5" />
              {t("commitGraph.legendBranch")}
            </li>
            <li className="rounded border border-brand/50 bg-brand/10 px-1 text-brand">
              {t("commitGraph.legendHead")}
            </li>
            <li className="text-[10px]">{t("commitGraph.hint")}</li>
          </ul>
        </div>
      )}
    </section>
  );
}
