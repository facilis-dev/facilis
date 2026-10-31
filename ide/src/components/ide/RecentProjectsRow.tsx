// One row of Home's "Recent projects" list.
//
// Split out of Home.tsx (whose size is pinned by the file-length ratchet) so that each
// project can also be opened in its OWN browser tab, which is how the Studio supports
// working on several projects at once: one project per tab, one kernel per tab.
import { useState } from "react";
import ExternalLink from "~icons/lucide/external-link";
import Trash from "~icons/lucide/trash-2";
import type { ProjectMeta } from "@/vv/controller";
import { openProjectInNewTab } from "@/vv/project-tabs";
import { projectName } from "@/vv/project-name";
import { useIde } from "./useIde";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { t } from "@/i18n";

export function relTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t("recent.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("recent.minutesAgo", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("recent.hoursAgo", { n: h });
  const d = Math.round(h / 24);
  return t("recent.daysAgo", { n: d });
}

export function RecentProjectsRow({ project }: { project: ProjectMeta }) {
  const { c } = useIde();
  const [deleting, setDeleting] = useState(false);
  const name = projectName(project.rootPath);
  return (
    <>
      <li className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/50 hover:bg-accent/30">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => void c.openProject(project)}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{projectName(project.rootPath)}</div>
            <div className="truncate text-xs text-muted-foreground">{project.rootPath}</div>
          </div>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {project.template ? project.template : t("recent.blank")} ·{" "}
            {relTime(project.lastModified)}
          </span>
        </button>
        <button
          title={t("recent.openInNewTab")}
          aria-label={t("recent.openInNewTabAria", { name: projectName(project.rootPath) })}
          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
          onClick={() => openProjectInNewTab(project.rootPath)}
        >
          <ExternalLink className="size-3.5" />
        </button>
        <button
          title={t("delete.action")}
          aria-label={t("delete.actionAria", { name })}
          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
          onClick={() => setDeleting(true)}
        >
          <Trash className="size-3.5" />
        </button>
      </li>
      <DeleteProjectDialog open={deleting} onOpenChange={setDeleting} rootPath={project.rootPath} />
    </>
  );
}
