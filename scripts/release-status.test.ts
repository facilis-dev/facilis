import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessPackage,
  collectCommitted,
  driftProblems,
  npmLatest,
  renderStatusReport,
} from "./release-status.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectCommitted", () => {
  it("reads the committed versions of non-private scoped packages, sorted", () => {
    const rows = collectCommitted([
      { name: "@facilis.dev/db", version: "0.2.0" },
      { name: "@facilis.dev/core", version: "0.1.10" },
      { name: "@facilis.dev/ide", version: "0.0.0", private: true },
      { name: "react", version: "19.0.0" },
    ]);
    expect(rows).toEqual([
      { name: "@facilis.dev/core", committed: "0.1.10" },
      { name: "@facilis.dev/db", committed: "0.2.0" },
    ]);
  });
});

describe("assessPackage", () => {
  const entry = { name: "@facilis.dev/core", committed: "0.1.10" };

  it("is in sync when npm latest equals the committed version", () => {
    expect(assessPackage(entry, { version: "0.1.10" })).toEqual({
      name: "@facilis.dev/core",
      committed: "0.1.10",
      latest: "0.1.10",
      state: "in-sync",
    });
  });

  it("reports drift in both directions", () => {
    const ahead = assessPackage({ ...entry, committed: "0.2.0" }, { version: "0.1.10" });
    expect(ahead.state).toBe("drift");
    expect(ahead.problem).toContain("ahead of");
    const behind = assessPackage(entry, { version: "0.2.0" });
    expect(behind.state).toBe("drift");
    expect(behind.problem).toContain("behind");
  });

  it("reports unpublished, unreachable and invalid states as problems", () => {
    expect(assessPackage(entry, { version: null }).state).toBe("unpublished");
    expect(assessPackage(entry, { error: "timeout" }).state).toBe("unreachable");
    expect(assessPackage({ ...entry, committed: "not-semver" }, { version: "0.1.10" }).state).toBe(
      "invalid",
    );
    expect(assessPackage(entry, { version: "next" }).problem).toContain("not semver");
    expect(driftProblems([assessPackage(entry, { version: "0.1.10" })])).toEqual([]);
  });
});

describe("renderStatusReport", () => {
  it("lists every package with committed, npm and state, tag as info only", () => {
    const rows = [
      assessPackage({ name: "@facilis.dev/core", committed: "0.1.10" }, { version: "0.1.10" }),
      assessPackage({ name: "@facilis.dev/db", committed: "0.2.0" }, { version: "0.1.10" }),
    ];
    const report = renderStatusReport(rows, {
      tag: "v0.1.10",
      tagCommit: "abcdef1234",
      tagDate: "2026-11-19",
      headCommit: "abcdef1234",
      branch: "main",
      ahead: 0,
    }).join("\n");
    expect(report).toContain("committed manifests are the truth");
    expect(report).toContain("@facilis.dev/core");
    expect(report).toContain("in-sync");
    expect(report).toContain("drift");
    expect(report).toContain("v0.1.10");
    expect(report).toContain("info: headline of the last released set");
    expect(report).toContain("(at the tag)");
    expect(driftProblems(rows)).toHaveLength(1);
  });
});

describe("npmLatest (mocked registry)", () => {
  it("returns the latest dist-tag, null on 404, an error on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ "dist-tags": { latest: "0.1.10" } }),
      })),
    );
    expect(await npmLatest("@facilis.dev/core")).toEqual({ version: "0.1.10" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404 })),
    );
    expect(await npmLatest("@facilis.dev/core")).toEqual({ version: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 503, ok: false })),
    );
    expect(await npmLatest("@facilis.dev/core")).toEqual({ error: "HTTP 503" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await npmLatest("@facilis.dev/core")).toEqual({ error: "offline" });
  });
});
