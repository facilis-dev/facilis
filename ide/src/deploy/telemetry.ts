// Production telemetry deploy options (D-203): build time only, off by default, no
// runtime switch (D-063/D-064). Facilis hosts nothing and receives nothing: the backend
// exports to the operator's own collector and the browser posts to the framework-owned
// ingestion route on its own origin.
//
// The halves are independent, and each one is checked against the target it needs, so an
// "enabled" build can never ship a pipeline that has nowhere to send its spans.

import {
  checkKeys,
  fieldBoolean,
  fieldObject,
  fieldOrigins,
  fieldRatio,
  fieldString,
  fieldUrl,
  type Obj,
} from "./fields.ts";
import type { DeploymentTelemetry, ResolvedTelemetry } from "./types.ts";

const TELEMETRY_KEYS = [
  "enabled",
  "be",
  "fe",
  "exporterEndpoint",
  "tenantKey",
  "sampling",
  "originAllowlist",
  "dashboardUrl",
] as const;

/** Shape and type checks; the cross-field rules live in `resolveTelemetry`, with defaults. */
export function checkTelemetry(telemetry: Obj, issues: string[]): void {
  const at = "deployment.telemetry";
  checkKeys(telemetry, TELEMETRY_KEYS, at, issues);
  fieldBoolean(telemetry, "enabled", at, issues);
  for (const side of ["be", "fe"] as const) {
    const block = fieldObject(telemetry, side, at, issues);
    if (block === undefined) continue;
    checkKeys(block, ["enabled"], at + "." + side, issues);
    fieldBoolean(block, "enabled", at + "." + side, issues);
  }
  fieldUrl(telemetry, "exporterEndpoint", at, issues);
  fieldUrl(telemetry, "dashboardUrl", at, issues);
  fieldRatio(telemetry, "sampling", at, issues);
  fieldOrigins(telemetry, "originAllowlist", at, issues);
  const tenantKey = fieldString(telemetry, "tenantKey", at, issues);
  // The public key travels in a header: whitespace is trimmed by some proxies and rejected
  // by others, so the config refuses it instead of shipping a key that may not match.
  if (tenantKey !== undefined && (tenantKey.trim() === "" || /\s/.test(tenantKey))) {
    issues.push(at + ".tenantKey: expected a non-empty string without whitespace");
  }
}

function withoutTrailingSlash(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  return raw === "" ? null : raw.replace(/\/+$/, "");
}

/** The ingestion route compares origins, so a configured entry is reduced to one. */
function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originsOf(values: readonly string[]): string[] {
  const origins: string[] = [];
  for (const value of values) {
    const origin = originOf(value);
    if (origin !== null && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** Disabled is a fresh object each time, so no two builds share a frozen half. */
function disabled(): ResolvedTelemetry {
  return {
    enabled: false,
    be: { enabled: false },
    fe: { enabled: false },
    exporterEndpoint: null,
    tenantKey: null,
    sampling: 1,
    originAllowlist: [],
    dashboardUrl: null,
  };
}

/**
 * Resolve the telemetry block. Off is the only state that needs no configuration; turning
 * it on requires the target for each enabled half, and options left behind a switch that is
 * off are errors — otherwise a later "just flip enabled" edit would activate them unseen.
 */
export function resolveTelemetry(
  raw?: DeploymentTelemetry,
  issues: string[] = [],
): ResolvedTelemetry {
  const exporterEndpoint = withoutTrailingSlash(raw?.exporterEndpoint);
  // A blank key is no key: the frontend half then fails its target check instead of
  // shipping a header the ingestion route would reject.
  const tenantKey = raw?.tenantKey?.trim() || null;
  const dashboardUrl = withoutTrailingSlash(raw?.dashboardUrl);
  const originAllowlist = originsOf(raw?.originAllowlist ?? []);

  if (raw?.enabled !== true) {
    if (raw?.be?.enabled === true) issues.push("telemetry.be.enabled: requires telemetry.enabled");
    if (raw?.fe?.enabled === true) issues.push("telemetry.fe.enabled: requires telemetry.enabled");
    if (exporterEndpoint !== null)
      issues.push("telemetry.exporterEndpoint: requires telemetry.enabled");
    if (tenantKey !== null) issues.push("telemetry.tenantKey: requires telemetry.enabled");
    if (raw?.sampling !== undefined) issues.push("telemetry.sampling: requires telemetry.enabled");
    if (originAllowlist.length > 0)
      issues.push("telemetry.originAllowlist: requires telemetry.enabled");
    if (dashboardUrl !== null) issues.push("telemetry.dashboardUrl: requires telemetry.enabled");
    return disabled();
  }

  // Both halves default to on: "telemetry.enabled" alone means the whole pipeline.
  const be = raw?.be?.enabled ?? true;
  const fe = raw?.fe?.enabled ?? true;
  if (!be && !fe) {
    issues.push("telemetry.enabled: requires telemetry.be.enabled or telemetry.fe.enabled");
  }
  if (be && exporterEndpoint === null) {
    issues.push("telemetry.exporterEndpoint: required when telemetry.be is enabled");
  }
  if (!be && exporterEndpoint !== null) {
    issues.push("telemetry.exporterEndpoint: requires telemetry.be.enabled");
  }
  // The browser holds the public write-only key; the collector credential stays server-side,
  // so a backend-only deployment never ships a key to the page.
  if (fe && tenantKey === null) {
    issues.push("telemetry.tenantKey: required when telemetry.fe is enabled");
  }
  if (!fe && tenantKey !== null) {
    issues.push("telemetry.tenantKey: requires telemetry.fe.enabled");
  }
  // The allowlist gates POSTs to the ingestion route, which only the frontend half uses.
  if (!fe && originAllowlist.length > 0) {
    issues.push("telemetry.originAllowlist: requires telemetry.fe.enabled");
  }

  return {
    enabled: true,
    be: { enabled: be },
    fe: { enabled: fe },
    exporterEndpoint,
    tenantKey,
    sampling: raw?.sampling ?? 1,
    originAllowlist,
    dashboardUrl,
  };
}
