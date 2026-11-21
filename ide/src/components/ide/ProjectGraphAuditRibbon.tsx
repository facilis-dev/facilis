// The contract lens's audit ribbon (issue #69): four counters docked in the bottom-left HUD
// cluster beside the stats ribbon and the lens chips. Each counter is a filter button with an
// active state (aria-pressed), the same pattern as the stats ribbon (issue #57): clicking toggles
// the counter in the URL-synced filter set, and matching nodes stay bright while the rest dim —
// never a removal, so positions hold (epic rule 2). Glyph + count + label on every button, so no
// state is colour-only (epic rule 6); the buttons are native tab stops (epic rule 6).

import CircleHelp from "~icons/lucide/circle-help";
import FileX from "~icons/lucide/file-x";
import ShieldCheck from "~icons/lucide/shield-check";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { t, type MessageKey } from "@/i18n";
import { AUDIT_FILTER_IDS, type AuditCounts, type AuditFilterId } from "@/facilis/graph-contract";
import { Button } from "@/components/ui/button";

const AUDIT_ICONS: Record<AuditFilterId, typeof ShieldCheck> = {
  protected: ShieldCheck,
  missingInput: FileX,
  unknown: CircleHelp,
  diagnostics: TriangleAlert,
};

const AUDIT_LABEL_KEYS: Record<AuditFilterId, MessageKey> = {
  protected: "projectGraph.audit.protected",
  missingInput: "projectGraph.audit.missingInput",
  unknown: "projectGraph.audit.unknown",
  diagnostics: "projectGraph.audit.diagnostics",
};

const AUDIT_HINT_KEYS: Record<AuditFilterId, MessageKey> = {
  protected: "projectGraph.audit.protectedHint",
  missingInput: "projectGraph.audit.missingInputHint",
  unknown: "projectGraph.audit.unknownHint",
  diagnostics: "projectGraph.audit.diagnosticsHint",
};

export interface ProjectGraphAuditRibbonProps {
  readonly counts: AuditCounts;
  readonly filters: readonly AuditFilterId[];
  readonly onToggle: (id: AuditFilterId) => void;
  /** No analysis yet: the counters render disabled, like the rest of the HUD. */
  readonly disabled: boolean;
}

export function ProjectGraphAuditRibbon({
  counts,
  filters,
  onToggle,
  disabled,
}: ProjectGraphAuditRibbonProps) {
  return (
    <div
      role="toolbar"
      aria-label={t("projectGraph.audit.label")}
      data-testid="graph-audit-ribbon"
      className="flex flex-wrap items-center gap-0.5"
    >
      {AUDIT_FILTER_IDS.map((id) => {
        const Icon = AUDIT_ICONS[id];
        const label = t(AUDIT_LABEL_KEYS[id]);
        const active = filters.includes(id);
        return (
          <Button
            key={id}
            variant="ghost"
            size="xs"
            data-testid={"graph-audit-" + id}
            aria-pressed={active}
            aria-label={t("projectGraph.audit.filterHint", { label })}
            title={t(AUDIT_HINT_KEYS[id])}
            disabled={disabled}
            className={active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}
            onClick={() => onToggle(id)}
          >
            <Icon />
            <span className="tabular-nums text-foreground">{counts[id]}</span>
            <span className="hidden xl:inline">{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
