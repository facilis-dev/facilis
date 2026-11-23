import { describe, expect, it } from "vitest";
import type { PrerenderEligibilityFact, SourceRef } from "@facilis.dev/analyze";
import { diffPrerenderSurfaces, pageRenderState } from "./release-prerender";

const ref = (file: string, line: number): SourceRef => ({ file, line });

function fact(overrides: Partial<PrerenderEligibilityFact> = {}): PrerenderEligibilityFact {
  return {
    path: "/about",
    declared: false,
    eligible: true,
    reasons: [],
    pageFile: "src/pages/about.tsx",
    source: ref("src/app.tsx", 4),
    unknown: [],
    ...overrides,
  };
}

describe("pageRenderState", () => {
  it("derives prerender only from declared AND eligible", () => {
    expect(pageRenderState(fact({ declared: true })).mode).toBe("prerender");
    expect(pageRenderState(fact()).mode).toBe("client");
    expect(pageRenderState(fact({ declared: true, eligible: false })).mode).toBe("client");
  });

  it("keeps declaration and eligibility visible for the blocked flag", () => {
    const state = pageRenderState(fact({ declared: true, eligible: false }));
    expect(state.declared).toBe(true);
    expect(state.eligible).toBe(false);
  });
});

describe("diffPrerenderSurfaces", () => {
  it("fails closed when either side is unreadable", () => {
    expect(diffPrerenderSurfaces(null, [])).toBeNull();
    expect(diffPrerenderSurfaces([], null)).toBeNull();
    expect(diffPrerenderSurfaces(null, null)).toBeNull();
  });

  it("is empty for two identical surfaces", () => {
    const facts = [fact({ declared: true }), fact({ path: "/" })];
    const diff = diffPrerenderSurfaces(facts, facts);
    expect(diff).not.toBeNull();
    expect(diff?.added).toEqual([]);
    expect(diff?.removed).toEqual([]);
    expect(diff?.changed).toEqual([]);
    expect(diff?.rows).toHaveLength(2);
  });

  it("reports a newly declared eligible page as added", () => {
    const diff = diffPrerenderSurfaces([fact()], [fact({ declared: true })]);
    expect(diff?.added).toEqual(["/about"]);
    expect(diff?.removed).toEqual([]);
    expect(diff?.rows[0]?.before?.mode).toBe("client");
    expect(diff?.rows[0]?.after?.mode).toBe("prerender");
  });

  it("reports an un-declared page as removed", () => {
    const diff = diffPrerenderSurfaces([fact({ declared: true })], [fact()]);
    expect(diff?.removed).toEqual(["/about"]);
    expect(diff?.added).toEqual([]);
  });

  it("reports a page that became ineligible as removed from the prerendered set", () => {
    const before = [fact({ declared: true })];
    const after = [
      fact({ declared: true, eligible: false, reasons: [{ reason: "auth-guarded" }] }),
    ];
    const diff = diffPrerenderSurfaces(before, after);
    expect(diff?.removed).toEqual(["/about"]);
    expect(diff?.rows[0]?.after?.eligible).toBe(false);
  });

  it("reports declaration churn without a mode change as changed", () => {
    // Eligible on both sides, but only declared after: client -> prerender is "added";
    // here the page stays client because it is ineligible on both sides, declaration flips.
    const before = [fact({ eligible: false })];
    const after = [fact({ eligible: false, declared: true })];
    const diff = diffPrerenderSurfaces(before, after);
    expect(diff?.added).toEqual([]);
    expect(diff?.removed).toEqual([]);
    expect(diff?.changed).toEqual(["/about"]);
  });

  it("marks a page absent at one ref with a null state", () => {
    const diff = diffPrerenderSurfaces([], [fact({ declared: true, path: "/new" })]);
    expect(diff?.added).toEqual(["/new"]);
    expect(diff?.rows[0]?.before).toBeNull();
    const reverse = diffPrerenderSurfaces([fact({ declared: true, path: "/gone" })], []);
    expect(reverse?.removed).toEqual(["/gone"]);
    expect(reverse?.rows[0]?.after).toBeNull();
  });

  it("sorts rows by path across the union of both sides", () => {
    const diff = diffPrerenderSurfaces(
      [fact({ path: "/z" })],
      [fact({ path: "/a" }), fact({ path: "/m" })],
    );
    expect(diff?.rows.map((row) => row.path)).toEqual(["/a", "/m", "/z"]);
  });
});
