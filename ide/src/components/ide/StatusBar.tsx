// VS Code-style status bar.
//
// Left:  the active folder's git branch (when it is a repo), live TS/JS
//        diagnostics from the language-service worker, the Run/Stop control and a
//        transient message slot ("saved page.tsx — hot-updating…").
// Right: the active editor's cursor position, indentation and language mode, each
//        opening a quick pick (see StatusBarPickers), then the bottom panel's only
//        controls — Console / Terminal / Ports (D-124).
//
// The readouts come from c.editorStatus / c.statusMessage, stores of their own, so
// a cursor move or a line of dev-server output doesn't re-render every useIde()
// consumer in the IDE.

import { useState, useSyncExternalStore } from "react";
import CircleX from "~icons/lucide/circle-x";
import TriangleAlert from "~icons/lucide/triangle-alert";
import GitBranch from "~icons/lucide/git-branch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { languageLabel } from "@/vv/editor-languages";
import { StatusBarPickers, type StatusPicker } from "./StatusBarPickers";
import { StatusBarPanels, StatusBarRun } from "./StatusBarRuntime";
import { ProjectUpdateBadge } from "./ProjectUpdateBadge";
import { useIde } from "./useIde";

export function StatusBar() {
  const { c, snap } = useIde();
  const { errors, warnings } = snap.problems;
  const scm = useSyncExternalStore(c.scm.subscribe, c.scm.getSnapshot);
  const editor = useSyncExternalStore(c.editorStatus.subscribe, c.editorStatus.getSnapshot);
  const message = useSyncExternalStore(c.statusMessage.subscribe, c.statusMessage.getSnapshot);
  const [picker, setPicker] = useState<StatusPicker>(null);

  // VS Code shows one repository at a time: the one owning the active file, else
  // the focused workspace folder, else the only repo there is.
  const repos = scm.repos.filter((r) => r.isRepo);
  const activeRoot = snap.workspaceFolders.find((f) => f.id === snap.activeFolderId)?.rootPath;
  const repo =
    (snap.activeTab
      ? repos.find((r) => snap.activeTab === r.root || snap.activeTab?.startsWith(r.root + "/"))
      : undefined) ??
    repos.find((r) => r.root === activeRoot) ??
    (repos.length === 1 ? repos[0] : undefined);
  const branch = repo ? (repo.currentBranch ?? "(detached)") : null;

  const { cursor, indent, language, pythonService } = editor;
  // Composed here rather than in one key: the catalogue has no plural machinery, and
  // "1 errors" reads wrong in a surface this exposed.
  const problemsLabel =
    errors +
    " " +
    t(errors === 1 ? "status.error" : "status.errors") +
    ", " +
    warnings +
    " " +
    t(warnings === 1 ? "status.warning" : "status.warnings");

  return (
    <>
      <div
        data-tour="status"
        className="flex h-6 shrink-0 items-center bg-brand px-1 text-xs text-brand-foreground"
      >
        {branch && (
          <StatusItem label={t("status.branch")} onClick={() => c.setActiveView("scm")}>
            <GitBranch className="size-3.5" />
            <span className="max-w-40 truncate">{branch}</span>
          </StatusItem>
        )}
        <ProjectUpdateBadge root={activeRoot ?? null} />
        {/* Live TS/JS diagnostics from the language-service worker. Not clickable:
            there's no Problems panel to open (markers surface in the editor). */}
        <StatusItem label={problemsLabel}>
          <CircleX className="size-3.5" />
          {errors}
          <TriangleAlert className="ml-1 size-3.5" />
          {warnings}
        </StatusItem>
        {/* Run/Stop, and the panel's door: both are always visible, so a run never
            needs the terminal and the terminal never needs the title bar (D-124). */}
        <StatusBarRun />
        {/* Transient feedback for routine operations (save, run, import). Auto-hides;
            min-w-0 keeps a long path from shoving the right side off. A run in
            progress outranks it — its chip is in StatusBarRun — and a stale status
            line must not sit next to it. */}
        {!snap.runPhase && message && <span className="min-w-0 truncate px-2">{message}</span>}

        <span className="flex-1" />

        {cursor && (
          <StatusItem label={t("status.goToLine")} onClick={() => setPicker("goto")}>
            {t("status.position", { line: cursor.line, column: cursor.column })}
            {cursor.selections > 1
              ? " " + t("status.selections", { count: cursor.selections })
              : cursor.selected > 0
                ? " " + t("status.selected", { count: cursor.selected })
                : null}
          </StatusItem>
        )}
        {indent && (
          <StatusItem label={t("status.indent")} onClick={() => setPicker("indent")}>
            {indent.insertSpaces ? "Spaces" : "Tab Size"}: {indent.tabSize}
          </StatusItem>
        )}
        {language && (
          <StatusItem label={t("status.language")} onClick={() => setPicker("language")}>
            {languageLabel(language)}
          </StatusItem>
        )}
        {/* Python's language service, once one has been asked for. A boot is
            seconds of nothing on the first .py file; this is what says so. */}
        {pythonService && <StatusItem label={t("status.python")}>{pythonService}</StatusItem>}
        <StatusBarPanels />
      </div>
      <StatusBarPickers open={picker} onClose={() => setPicker(null)} />
    </>
  );
}

/** One status-bar cell. With onClick it's a button carrying VS Code's hover
 * highlight; without one it's a plain readout. */
function StatusItem({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={onClick ? undefined : <span />}
        onClick={onClick}
        className={cn(
          "flex h-6 items-center gap-1 whitespace-nowrap px-2",
          onClick && "transition-colors hover:bg-brand-foreground/20",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
