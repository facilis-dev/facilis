// The project-vs-build update indicator (D-065, APP-UPDATES.md §3).
//
// A read-only indicator: it compares the active project's marker and framework pins
// (D-198) with this build and opens a panel listing the steps. The apply action ships
// with the boot gate (framework-gate.ts), which reuses the same engine.

import { useEffect, useState, useSyncExternalStore } from "react";
import CircleArrowUp from "~icons/lucide/circle-arrow-up";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { approvedBaseline, checkProject } from "@/facilis/app-status";
import { getFrameworkGate, subscribeFrameworkGate } from "@/facilis/framework-gate";
import { UPDATE_RECIPES } from "@/facilis/update-recipes";
import type { UpgradePlan } from "@/facilis/upgrade/plan";
import { t } from "@/i18n";
import { useIde } from "./useIde";

/** Rendered in the status bar; nothing when the project is current or unknown. */
export function ProjectUpdateBadge({ root }: { root: string | null }) {
  const { c } = useIde();
  const [plan, setPlan] = useState<UpgradePlan | null>(null);
  const [open, setOpen] = useState(false);
  // D-198: re-check when the boot gate resolves (an applied update fixes the pins this
  // badge reports on); the gate store is the only event that changes the plan in place.
  const gate = useSyncExternalStore(subscribeFrameworkGate, getFrameworkGate);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    if (root === null) return;
    void checkProject((path) => c.readFileText(path), root, undefined, UPDATE_RECIPES)
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [c, root, gate]);

  if (plan === null || (plan.status !== "outdated" && plan.status !== "ahead")) return null;
  const outdated = plan.status === "outdated";
  const baseline = approvedBaseline();

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={() => setOpen(true)}
              className="flex h-6 items-center gap-1 whitespace-nowrap px-2 transition-colors hover:bg-brand-foreground/20"
            />
          }
        >
          <CircleArrowUp className="size-3.5" />
          <span>{outdated ? t("updates.available") : t("updates.aheadBadge")}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("updates.tooltip", {
            project: plan.projectVersion ?? t("updates.unknown"),
            build: plan.currentVersion,
          })}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("updates.title")}</DialogTitle>
            <DialogDescription>
              {outdated ? t("updates.description") : t("updates.ahead")}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("updates.projectVersion")}</dt>
            <dd>{plan.projectVersion ?? t("updates.unknown")}</dd>
            <dt className="text-muted-foreground">{t("updates.buildVersion")}</dt>
            <dd>{plan.currentVersion}</dd>
          </dl>
          {outdated && plan.steps.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("updates.noRecipe")}</p>
          )}
          {outdated && plan.steps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {plan.steps.map((step) => (
                <li key={step.to}>
                  {t(step.titleKey)}
                  {step.files.length > 0 && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {step.files.join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {baseline !== "" && (
            <p className="text-xs text-muted-foreground">{t("updates.baseline", { baseline })}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
