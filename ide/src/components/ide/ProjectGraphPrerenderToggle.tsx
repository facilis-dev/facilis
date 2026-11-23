// The page inspector's prerender toggle (D-202, issue #84): declares the page in the
// project's allowlist through a studio write and shows the analyzer's eligibility chips.
// An ineligible page keeps the toggle off with every blocking reason named — never a silent
// guess (D-092). A declared-but-ineligible page can still be turned off: the build fails on
// it, so removing the declaration must remain possible.

import { useState } from "react";
import type { PrerenderEligibilityFact, PrerenderIneligibilityReason } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { prerenderChips } from "@/facilis/graph-prerender";
import { Chip, DetailsSection, EmptyNote } from "./ProjectGraphDetailsSection";

const REASON_LABELS: Record<PrerenderIneligibilityReason, MessageKey> = {
  "private-api": "projectGraph.prerender.privateApi",
  "auth-guarded": "projectGraph.prerender.authGuarded",
  "unknown-security": "projectGraph.prerender.unknownSecurity",
  "dynamic-path": "projectGraph.prerender.dynamicPath",
  redirect: "projectGraph.prerender.redirect",
};

export interface ProjectGraphPrerenderToggleProps {
  /** The route-table path the toggle declares (the page's first path, as the preview). */
  readonly path: string;
  readonly fact: PrerenderEligibilityFact | null;
  readonly onToggle: (path: string, enabled: boolean) => Promise<boolean>;
}

export function ProjectGraphPrerenderToggle({
  path,
  fact,
  onToggle,
}: ProjectGraphPrerenderToggleProps) {
  const [busy, setBusy] = useState(false);
  const declared = fact?.declared === true;
  const eligible = fact?.eligible === true;
  const blocked = fact !== null && !eligible;
  // Enabling requires eligibility; a declared-but-ineligible page keeps the off switch live.
  // No fact at all is unknown, never eligible (D-092): the toggle stays disabled.
  const disabled = busy || fact === null || (blocked && !declared);
  const chips = prerenderChips(fact);
  const handleClick = (): void => {
    if (disabled) return;
    setBusy(true);
    void onToggle(path, !declared).finally(() => setBusy(false));
  };
  return (
    <DetailsSection title={t("projectGraph.prerender.title")}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          role="switch"
          aria-checked={declared}
          aria-label={t("projectGraph.prerender.toggle")}
          data-testid="project-graph-prerender-toggle"
          disabled={disabled}
          title={
            fact === null
              ? t("projectGraph.prerender.noFact")
              : blocked && !declared
                ? t("projectGraph.prerender.blockedHint")
                : t("projectGraph.prerender.toggleHint")
          }
          onClick={handleClick}
          className={cn(
            "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
            declared
              ? eligible
                ? "border-brand/50 bg-brand/20 text-brand"
                : "border-warning/50 bg-warning/20 text-warning"
              : "border-border bg-muted text-muted-foreground",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-current transition-all",
              declared ? "left-3.5" : "left-0.5",
            )}
          />
        </button>
        <span className="text-[10px]">{t("projectGraph.prerender.toggle")}</span>
      </div>
      {fact === null ? (
        <EmptyNote message={t("projectGraph.prerender.noFact")} />
      ) : (
        <div className="flex flex-wrap gap-1" data-testid="project-graph-prerender-chips">
          {chips.map((chip) => (
            <Chip key={chip.id} tone={chip.tone} mono={chip.route !== null}>
              {chip.reason === "eligible"
                ? t("projectGraph.prerender.eligible")
                : chip.reason === "private-api"
                  ? t(REASON_LABELS["private-api"], { route: chip.route ?? "" })
                  : t(REASON_LABELS[chip.reason])}
            </Chip>
          ))}
        </div>
      )}
      {blocked && (
        <p className="text-[9px] text-warning">
          {declared
            ? t("projectGraph.prerender.declaredIneligible")
            : t("projectGraph.prerender.blockedHint")}
        </p>
      )}
    </DetailsSection>
  );
}
