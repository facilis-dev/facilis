import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis.dev/ai";
import { DESIGN_EVAL_CASES, scoreDesignAnswer } from "./design-eval";

const DEPS = new Set([
  "react",
  "react-dom",
  "react-router-dom",
  "@base-ui/react",
  "@facilis.dev/core",
  "sonner",
]);

function patch(path: string, content: string): FilePatch {
  return { path, action: "create", content };
}

const GOOD_PAGE = [
  'import { useEffect, useState } from "react";',
  'import { t } from "@facilis.dev/core/i18n";',
  'import { Page } from "../components/ui/page.tsx";',
  'import { Skeleton } from "../components/ui/skeleton.tsx";',
  'import { EmptyState } from "../components/ui/empty-state.tsx";',
  'import { Alert } from "../components/ui/alert.tsx";',
  'import { api } from "../lib/api.ts";',
  "export function ReportsPage() {",
  "  const [rows, setRows] = useState<readonly string[]>([]);",
  '  useEffect(() => { void api<readonly string[]>("/api/reports").then(setRows); }, []);',
  '  return <Page title={t("reports.title")}>{rows.length === 0 ? <EmptyState title="x" /> : <Skeleton />}</Page>;',
  "}",
].join("\n");

const GOOD_LOCALES = JSON.stringify({ "reports.title": "Reports" }, null, 2) + "\n";

describe("design eval suite", () => {
  it("names six distinct cases", () => {
    expect(DESIGN_EVAL_CASES).toHaveLength(6);
    expect(new Set(DESIGN_EVAL_CASES.map((entry) => entry.id)).size).toBe(6);
    for (const entry of DESIGN_EVAL_CASES) expect(entry.prompt.length).toBeGreaterThan(20);
  });
});

describe("scoreDesignAnswer", () => {
  it("passes a page that follows the contract", () => {
    const score = scoreDesignAnswer(
      [patch("src/pages/reports.tsx", GOOD_PAGE), patch("locales/en.json", GOOD_LOCALES)],
      DEPS,
    );
    expect(score.criteria.filter((criterion) => !criterion.pass)).toEqual([]);
    expect(score.passed).toBe(score.total);
    expect(score.files).toBe(2);
  });

  it("fails a page that invents its own shell", () => {
    const score = scoreDesignAnswer(
      [patch("src/pages/reports.tsx", "export const X = () => <div>hi</div>;")],
      DEPS,
    );
    const shell = score.criteria.find((criterion) => criterion.criterion === "page-shell");
    expect(shell?.pass).toBe(false);
    expect(shell?.detail).toContain("does not render <Page>");
  });

  it("fails on a raw colour", () => {
    const page = GOOD_PAGE.replace("<Page", '<Page className="text-[#0b0d10]"');
    const score = scoreDesignAnswer([patch("src/pages/reports.tsx", page)], DEPS);
    const tokens = score.criteria.find((criterion) => criterion.criterion === "tokens");
    expect(tokens?.pass).toBe(false);
    expect(tokens?.detail).toContain("#0b0d10");
  });

  it("fails when a fetching page ships no states", () => {
    const page = GOOD_PAGE.replace(/import \{ Skeleton.*\n/, "").replace(
      "<Skeleton />",
      "<span />",
    );
    const score = scoreDesignAnswer([patch("src/pages/reports.tsx", page)], DEPS);
    const states = score.criteria.find((criterion) => criterion.criterion === "states");
    expect(states?.pass).toBe(false);
  });

  it("fails on an undeclared dependency or a package.json write", () => {
    const withImport = GOOD_PAGE.replace(
      "import { Page }",
      'import { format } from "date-fns";\nimport { Page }',
    );
    const score = scoreDesignAnswer(
      [patch("src/pages/reports.tsx", withImport), patch("package.json", "{}")],
      DEPS,
    );
    const deps = score.criteria.find((criterion) => criterion.criterion === "dependencies");
    expect(deps?.pass).toBe(false);
    expect(deps?.detail).toContain("package.json");
  });

  it("fails on a motion library", () => {
    const withMotion = GOOD_PAGE.replace(
      "import { Page }",
      'import { motion } from "motion/react";\nimport { Page }',
    );
    const score = scoreDesignAnswer([patch("src/pages/reports.tsx", withMotion)], DEPS);
    const motion = score.criteria.find((criterion) => criterion.criterion === "motion");
    expect(motion?.pass).toBe(false);
    expect(motion?.detail).toContain("motion");
  });

  it("fails on filler copy and exclamation marks", () => {
    const locales = JSON.stringify({ "reports.title": "Reports!", "reports.blurb": "Seamless" });
    const score = scoreDesignAnswer([patch("locales/en.json", locales)], DEPS);
    const copy = score.criteria.find((criterion) => criterion.criterion === "copy");
    expect(copy?.pass).toBe(false);
    expect(copy?.detail).toContain("exclamation");
  });
});
