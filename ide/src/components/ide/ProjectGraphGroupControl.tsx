// The inspector's feature-group control (issue #194 follow-up): show the current group and the
// rule that chose it, then let the user pin the node to another group. The override is saved in
// .facilis/graph/groups/<key>.json as team state; clearing the field restores the automatic rule.

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import type { DomainAssignment, DomainReason } from "@/facilis/graph-surface/domains.ts";

const REASON_KEYS: Readonly<Record<DomainReason, MessageKey>> = {
  override: "projectGraph.group.reason.override",
  "route-path": "projectGraph.group.reason.routePath",
  "route-file": "projectGraph.group.reason.routeFile",
  "page-calls": "projectGraph.group.reason.pageCalls",
  "page-directory": "projectGraph.group.reason.pageDirectory",
  "page-path": "projectGraph.group.reason.pagePath",
  reference: "projectGraph.group.reason.reference",
  framework: "projectGraph.group.reason.framework",
  core: "projectGraph.group.reason.core",
};

export function ProjectGraphGroupControl({
  nodeId,
  assignment,
  groups,
  onSetGroup,
}: {
  nodeId: string;
  assignment: DomainAssignment;
  /** Existing group names, offered as suggestions; a new name is valid too. */
  groups: readonly string[];
  onSetGroup: (id: string, group: string | null) => void;
}) {
  const [draft, setDraft] = useState(assignment.group);
  const listId = useId();
  useEffect(() => {
    setDraft(assignment.group);
  }, [nodeId, assignment.group]);

  const apply = () => {
    const next = draft.trim();
    onSetGroup(nodeId, next.length === 0 ? null : next);
  };
  const reset = () => {
    onSetGroup(nodeId, null);
  };
  const overridden = assignment.reason === "override";

  return (
    <section
      data-testid="project-graph-group-control"
      className="rounded-md border bg-card p-2 text-[11px]"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.group.title")}
        </span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {assignment.group}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{t(REASON_KEYS[assignment.reason])}</p>
      {assignment.evidence !== null && (
        <p
          className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
          title={assignment.evidence}
        >
          {assignment.evidence}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1">
        <input
          type="text"
          list={listId}
          value={draft}
          placeholder={t("projectGraph.group.placeholder")}
          aria-label={t("projectGraph.group.label")}
          className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(assignment.group);
            }
          }}
        />
        <Button variant="ghost" size="xs" onClick={apply}>
          {t("projectGraph.group.apply")}
        </Button>
        <Button variant="ghost" size="xs" disabled={!overridden} onClick={reset}>
          {t("projectGraph.group.reset")}
        </Button>
      </div>
      <datalist id={listId}>
        {groups.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>
      <p className="mt-1 text-[10px] text-muted-foreground">{t("projectGraph.group.hint")}</p>
    </section>
  );
}
