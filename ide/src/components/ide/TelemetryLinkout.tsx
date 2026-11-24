// The observability link-out entry (D-203 §6, issue #140): a per-project button that opens
// the operator's dashboard in an external tab. It renders only when this build compiled a
// dashboard URL into an enabled telemetry policy; the IDE never queries, stores or fetches
// anything for it. The view renders the sidebar footer entry (bar + button) and is
// prop-driven so it can be rendered to static markup in tests (ide/ ships no jsdom — the
// RecentProjectsRowView pattern). When absent it returns null, so no empty bar is left behind.

import ExternalLink from "~icons/lucide/external-link";
import { Button } from "@/components/ui/button";
import { deployment } from "@/deploy/current";
import { openTelemetryDashboard, telemetryLinkoutTarget } from "@/facilis/telemetry-linkout";
import { t } from "@/i18n";

/** Reads this build's telemetry policy once per render; absent when there is no target. */
export function TelemetryLinkout() {
  return <TelemetryLinkoutView url={telemetryLinkoutTarget(deployment.telemetry)} />;
}

/** The entry itself: null (nothing rendered) when no dashboard URL is configured. */
export function TelemetryLinkoutView({ url }: { url: string | null }) {
  if (url === null) return null;
  return (
    <div className="flex items-center gap-1 border-t px-2 py-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="min-w-0 truncate justify-start gap-1.5 text-xs text-muted-foreground"
        title={t("telemetry.linkout.tooltip")}
        onClick={() => openTelemetryDashboard(url)}
      >
        <ExternalLink data-icon="inline-start" />
        {t("telemetry.linkout.label")}
      </Button>
    </div>
  );
}
