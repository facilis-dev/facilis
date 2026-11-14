import { describe, expect, it } from "vitest";
import { parseDesignAnswer, summarizeDesignEval } from "./design-eval-report";
import { scoreDesignAnswer } from "./design-eval";

const DEPS = new Set(["react"]);

const PAGE = [
  'import { Page } from "../components/ui/page.tsx";',
  'export const P = () => <Page title="x">hi</Page>;',
].join("\n");

describe("parseDesignAnswer", () => {
  it("reads a bare object and a fenced one", () => {
    expect(parseDesignAnswer('{"patches": []}')?.patches).toEqual([]);
    expect(parseDesignAnswer('```json\n{"message": "ok"}\n```')?.message).toBe("ok");
  });

  it("recovers an object wrapped in prose", () => {
    expect(parseDesignAnswer('Here it is: {"patches": []} — done.')?.patches).toEqual([]);
  });

  it("returns null when there is nothing to parse", () => {
    expect(parseDesignAnswer("no json here")).toBeNull();
    expect(parseDesignAnswer("{ not json }")).toBeNull();
  });
});

describe("summarizeDesignEval", () => {
  const passing = scoreDesignAnswer(
    [{ path: "src/pages/a.tsx", action: "create", content: PAGE }],
    DEPS,
  );
  const failing = scoreDesignAnswer(
    [{ path: "src/pages/a.tsx", action: "create", content: "<div />" }],
    DEPS,
  );

  it("tabulates each case and the criteria", () => {
    const summary = summarizeDesignEval(
      [
        { case: "dashboard", seed: 1, ms: 1000, tokens: 1200, score: passing },
        { case: "auth", seed: 1, ms: 2000, tokens: 800, score: null },
      ],
      { model: "demo", seeds: 1 },
    );
    expect(summary).toContain("| dashboard | 1.00 |");
    expect(summary).toContain("| auth | - |");
    expect(summary).toContain("| criterion | pass rate |");
    expect(summary).not.toContain("## Failures");
  });

  it("lists every failure with its path", () => {
    const summary = summarizeDesignEval(
      [{ case: "dashboard", seed: 1, ms: 1000, tokens: 900, score: failing }],
      { model: "demo", seeds: 1 },
    );
    expect(summary).toContain("## Failures");
    expect(summary).toContain("- dashboard #1: page-shell");
  });
});
