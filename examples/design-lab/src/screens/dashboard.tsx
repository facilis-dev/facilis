import { useState } from "react";
import { Button, EmptyState, Page, toast } from "@facilis/ui";
import { AppShell } from "../components/app-shell.tsx";
import { Pagination, TableToolbar, type SegmentedOption } from "../components/bits.tsx";
import { Card, StatCard } from "../components/card.tsx";
import { Dialog } from "../components/dialog.tsx";
import { currentUser, projects as seedProjects, stats, type Project } from "../data.ts";
import { IconExternal, IconFolder, IconPlus, IconTrend, IconUsers } from "../icons.tsx";
import { DashboardTable } from "./dashboard-table.tsx";

const PAGE_SIZE = 5;

const STATUS_OPTIONS: readonly SegmentedOption[] = [
  { id: "all", label: "All statuses" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "archived", label: "Archived" },
];

const VIEW_OPTIONS: readonly SegmentedOption[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
];

const STAT_ICONS = [
  <IconFolder key="projects" />,
  <IconUsers key="team" />,
  <IconTrend key="storage" />,
];

/** Dashboard: shell + stats + filterable table + row actions, all client-side mock data. */
export function DashboardScreen() {
  const [rows, setRows] = useState<readonly Project[]>(seedProjects);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = rows.filter((project) => {
    const matchesQuery =
      query === "" ||
      [project.name, project.description, project.owner.name].some((value) =>
        value.toLowerCase().includes(query),
      );
    const matchesStatus = status === "all" || project.status === status;
    const matchesView = view === "all" || project.owner.id === currentUser.id;
    return matchesQuery && matchesStatus && matchesView;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function resetFilters(): void {
    setSearch("");
    setStatus("all");
    setView("all");
    setPage(1);
  }

  function archiveProject(project: Project): void {
    setRows((previous) => previous.filter((row) => row.id !== project.id));
    toast.success(project.name + " archived");
  }

  function deleteProject(): void {
    const project = pendingDelete;
    if (project === null) return;
    setRows((previous) => previous.filter((row) => row.id !== project.id));
    setPendingDelete(null);
    toast.success(project.name + " deleted");
  }

  return (
    <AppShell activeNav="Overview" breadcrumb={["Workspace", "Projects"]}>
      <Page
        title="Projects"
        description="Every project your team is building, with owners, status and the latest activity."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => toast.info("Export queued — a download link is on its way")}
            >
              <IconExternal size={14} />
              Export
            </Button>
            <Button onClick={() => toast.info("The block picker opens here in a real project")}>
              <IconPlus size={14} />
              New project
            </Button>
          </>
        }
      >
        <section className="lab-stats" aria-label="Workspace summary">
          {stats.map((stat, index) => (
            <StatCard key={stat.label} {...stat} icon={STAT_ICONS[index]} />
          ))}
        </section>

        <Card flush>
          <TableToolbar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            status={status}
            onStatusChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            statusOptions={STATUS_OPTIONS}
            view={view}
            onViewChange={(value) => {
              setView(value);
              setPage(1);
            }}
            viewOptions={VIEW_OPTIONS}
          />
          {visible.length === 0 ? (
            <div className="lab-empty">
              <EmptyState
                title="No projects match these filters"
                description="Try another status, clear the search, or switch back to all projects."
                action={
                  <Button variant="ghost" onClick={resetFilters}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <DashboardTable
                projects={visible}
                onArchive={archiveProject}
                onDelete={setPendingDelete}
              />
              <Pagination
                page={currentPage}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      </Page>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete project?"
        description={
          pendingDelete === null
            ? undefined
            : pendingDelete.name +
              " and its history will be removed for every member. This cannot be undone."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteProject}>
              Delete project
            </Button>
          </>
        }
      >
        <p className="lab-hint">
          Members keep their other projects, and billing usage is recalculated at the end of the
          month.
        </p>
      </Dialog>
    </AppShell>
  );
}
