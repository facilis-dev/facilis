// The observability link-out (D-203 §6, issue #140): the IDE only opens the operator's own
// dashboard in an external tab. No backend query, no telemetry token, no remote feed, no
// credential stored, no fetch of any kind — the target is the build-time deploy option
// telemetry.dashboardUrl, so a disabled or unconfigured build has nothing to open.

import type { ResolvedTelemetry } from "@/deploy/types";

/**
 * The dashboard URL to open, or null when this build has no link-out. resolveTelemetry
 * already nulls dashboardUrl when disabled; the enabled check keeps the derivation correct
 * for any ResolvedTelemetry a caller hands in, not only freshly resolved ones.
 */
export function telemetryLinkoutTarget(telemetry: ResolvedTelemetry): string | null {
  if (!telemetry.enabled || telemetry.dashboardUrl === null) return null;
  return telemetry.dashboardUrl;
}

/** Open the dashboard in an external tab; noopener keeps the IDE window unreachable (D-033). */
export function openTelemetryDashboard(url: string): void {
  window.open(url, "_blank", "noopener");
}
