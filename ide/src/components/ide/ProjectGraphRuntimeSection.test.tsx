// The runtime section's rendered contract (issue #72), as static markup (the ide/ pattern: no
// jsdom). The empty state's exact wording, the unknown percentile label, the 60-bucket sparkline
// and the window following are the acceptance surface; the store maths live in graph-runtime.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { RUNTIME_SPARK_BUCKETS, getRuntimeLensStore } from "@/facilis/graph-runtime";
import type { RouteGraphData } from "@/facilis/graph-types";
import { ProjectGraphRuntimeSection } from "./ProjectGraphRuntimeSection";

const T0 = 1_700_000_000_000;
const A = "/api/todos";

const route: RouteGraphData = {
  kind: "route",
  method: "GET",
  path: A,
  permission: [],
  wrapper: "valid",
  description: null,
  input: { body: false, form: false, query: false, params: false },
  pathParams: [],
  dbTables: [],
  elevations: [],
  unknown: false,
};

const store = getRuntimeLensStore();
const ingest = (samples: { status: number; duration: number; at?: number }[]) => {
  for (const sample of samples) {
    store.ingest(
      [{ route: A, method: "GET", status: sample.status, duration: sample.duration }],
      sample.at ?? T0,
    );
  }
};

function markup(window: "1m" | "5m" | "15m" = "5m"): string {
  return renderToStaticMarkup(<ProjectGraphRuntimeSection route={route} window={window} />);
}

/** The rect at a bucket index, sliced out of the sparkline SVG. */
function rectAt(html: string, index: number): string {
  const start = html.indexOf('data-testid="runtime-sparkline"');
  const svg = html.slice(start, html.indexOf("</svg>", start));
  const rect = svg.slice(svg.indexOf('x="' + (index + 0.1) + '"'));
  return rect.slice(0, rect.indexOf("/>"));
}

beforeEach(() => {
  initI18n();
  setLocale("en");
  store.dispose();
  store.enable([A]);
});

describe("empty state (criterion 4)", () => {
  it("says exactly 'no traffic in this window', muted, never green", () => {
    const html = markup();
    expect(html).toContain("no traffic in this window");
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain("bg-success");
    expect(html).not.toContain("text-success");
    expect(html).not.toContain('data-testid="runtime-sparkline"');
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    expect(markup()).toContain("nessun traffico in questa finestra");
  });
});

describe("traffic facts", () => {
  it("shows count, error rate and the latency percentiles", () => {
    ingest([
      { status: 200, duration: 8 },
      { status: 200, duration: 12 },
      { status: 503, duration: 20 },
      { status: 401, duration: 5 },
    ]);
    const html = markup();
    expect(html).toContain('data-testid="inspector-runtime"');
    expect(html).toContain('data-testid="runtime-stat-count"');
    expect(html).toContain(">4<");
    expect(html).toContain(">25%<"); // 1 of 4 is a 5xx
    expect(html).toContain('data-testid="runtime-stat-p50"');
    expect(html).toContain('data-testid="runtime-stat-p95"');
    expect(html).toContain("ms");
    // The 4xx is named separately, never folded into the error rate.
    expect(html).toContain("1 client errors (4xx)");
  });

  it("a null percentile renders 'beyond measurable range', never 0 (epic rule 5)", () => {
    ingest([{ status: 200, duration: 40_000 }]);
    const html = markup();
    expect(html).toContain("beyond measurable range");
    expect(html).not.toContain(">0 ms<");
  });

  it("names aborted requests when present", () => {
    ingest([
      { status: 0, duration: 3 },
      { status: 200, duration: 8 },
    ]);
    expect(markup()).toContain("1 aborted");
  });

  it("follows the selected window", () => {
    ingest([{ status: 200, duration: 8, at: T0 - 120_000 }]); // outside 1m, inside 5m/15m
    store.tick(T0); // observe at T0, like the live tick would
    expect(markup("1m")).toContain("no traffic in this window");
    expect(markup("5m")).toContain('data-testid="inspector-runtime"');
    expect(markup("15m")).toContain('data-testid="inspector-runtime"');
  });
});

describe("sparkline (criterion 5)", () => {
  it("draws 60 buckets as an inline SVG with an accessible name", () => {
    ingest([
      { status: 200, duration: 8 },
      { status: 200, duration: 8 },
    ]);
    const html = markup();
    const start = html.indexOf('data-testid="runtime-sparkline"');
    expect(start).toBeGreaterThanOrEqual(0);
    const svg = html.slice(start, html.indexOf("</svg>", start));
    expect(svg).toContain('role="img"');
    expect(svg).toContain("Requests per bucket over the last 5 min");
    expect(svg).toContain('viewBox="0 0 60 16"');
    expect((svg.match(/<rect/g) ?? []).length).toBe(RUNTIME_SPARK_BUCKETS);
    // Semantic token, not a raw palette colour.
    expect(svg).toContain("text-info");
    expect(svg).toContain('fill="currentColor"');
  });

  it("reflects the selected window's bucket width", () => {
    ingest([{ status: 200, duration: 8, at: T0 - 30_000 }]);
    store.tick(T0); // observe at T0, like the live tick would
    const narrow = markup("1m");
    const wide = markup("5m");
    // Same sample, different bucket: the 1m sparkline puts it at 30, the 5m at 54.
    expect(rectAt(narrow, 30)).toContain('height="16"');
    expect(rectAt(wide, 54)).toContain('height="16"');
    expect(rectAt(narrow, 54)).toContain('height="0"');
  });
});
