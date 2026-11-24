// ide/ ships no jsdom or testing-library: the entry is rendered to a static string with
// react-dom/server (the RecentProjectsRow.test.tsx pattern). The wrapper reads the build's
// deployment, so a hoisted mock flips its telemetry block (the commit-graph-session pattern)
// while the presentational view stays prop-driven.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { ResolvedTelemetry } from "@/deploy/types";
import { TelemetryLinkout, TelemetryLinkoutView } from "./TelemetryLinkout";

const mocks = vi.hoisted(() => ({
  telemetry: {
    enabled: false,
    be: { enabled: false },
    fe: { enabled: false },
    exporterEndpoint: null,
    tenantKey: null,
    sampling: 1,
    originAllowlist: [],
    dashboardUrl: null,
  } as ResolvedTelemetry,
}));

vi.mock("@/deploy/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/deploy/current")>();
  return { ...actual, deployment: { ...actual.deployment, telemetry: mocks.telemetry } };
});

beforeEach(() => {
  initI18n();
  setLocale("en");
  mocks.telemetry.enabled = false;
  mocks.telemetry.dashboardUrl = null;
});

describe("TelemetryLinkoutView", () => {
  it("renders the entry when a dashboard URL is configured", () => {
    const html = renderToStaticMarkup(<TelemetryLinkoutView url="https://ops.example/grafana" />);
    expect(html).toContain('data-slot="button"');
    expect(html).toContain(t("telemetry.linkout.label"));
    expect(html).toContain(t("telemetry.linkout.tooltip"));
  });

  it("is absent when there is no target", () => {
    expect(renderToStaticMarkup(<TelemetryLinkoutView url={null} />)).toBe("");
  });
});

describe("TelemetryLinkout", () => {
  it("is absent when telemetry is disabled", () => {
    expect(renderToStaticMarkup(<TelemetryLinkout />)).toBe("");
  });

  it("is absent when enabled but no URL is set", () => {
    mocks.telemetry.enabled = true;
    expect(renderToStaticMarkup(<TelemetryLinkout />)).toBe("");
  });

  it("renders when enabled and a URL is configured", () => {
    mocks.telemetry.enabled = true;
    mocks.telemetry.dashboardUrl = "https://ops.example/grafana";
    const html = renderToStaticMarkup(<TelemetryLinkout />);
    expect(html).toContain(t("telemetry.linkout.label"));
  });
});
