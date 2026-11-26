/**
 * D-218 gate: dynamic t() keys and locale parity over the shipped apps. Both checks are
 * warnings (the app still runs, the runtime is unchanged), so this gate never fails on a
 * warning; it proves both on failing/passing fixtures, keeps malformed catalogues on their
 * existing single warning, and reports the shipped examples' counts instead of hiding them.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeProject } from "./analyze.ts";
import { loadProjectFiles } from "./fs.ts";
import { createOxcParser } from "./node.ts";
import { I18N_LOCALE_PARITY_CODE } from "./passes/i18n.ts";
import { I18N_DYNAMIC_KEY_CODE } from "./passes/i18n-keys.ts";

const PARSER = createOxcParser();

/** Walk up from this file so the gate does not depend on the process cwd. */
function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (readdirSync(current).includes("pnpm-workspace.yaml")) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate the repo root from " + import.meta.url);
    current = parent;
  }
}

const REPO_ROOT = repositoryRoot();

function diagnosticsOf(files: Record<string, string>) {
  return analyzeProject({ files: new Map(Object.entries(files)), parser: PARSER }).diagnostics;
}

function shippedApps(): string[] {
  return readdirSync(join(REPO_ROOT, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(REPO_ROOT, "examples", entry.name))
    .toSorted((left, right) => left.localeCompare(right));
}

describe("i18n gate (D-218)", () => {
  it("warns on dynamic keys and passes registered literals and static templates", () => {
    const diagnostics = diagnosticsOf({
      "locales/en.json": '{ "app.title": "Todos" }',
      "src/page.ts":
        'export const a = t("app.title");\n' +
        "export const b = t(`app.title`);\n" +
        "export const c = t(key);\n" +
        'export const d = t("app." + suffix);\n',
    });
    const dynamic = diagnostics.filter((entry) => entry.code === I18N_DYNAMIC_KEY_CODE);
    expect(dynamic).toHaveLength(2);
    expect(dynamic.every((entry) => entry.severity === "warning")).toBe(true);
    expect(dynamic.every((entry) => entry.source?.file === "src/page.ts")).toBe(true);
  });

  it("warns on a key missing from a secondary locale and on a secondary-only key", () => {
    const diagnostics = diagnosticsOf({
      "locales/en.json": '{ "a": "A", "b": "B" }',
      "locales/it.json": '{ "a": "A", "only.it": "X" }',
    });
    const parity = diagnostics.filter((entry) => entry.code === I18N_LOCALE_PARITY_CODE);
    expect(parity).toHaveLength(2);
    expect(parity.every((entry) => entry.severity === "warning")).toBe(true);
    expect(parity.map((entry) => entry.message).toSorted()).toEqual([
      'locale key "b" is in locales/en.json but missing from locales/it.json.',
      'locale key "only.it" is in locales/it.json but missing from locales/en.json.',
    ]);
  });

  it("keeps one existing warning for a malformed catalogue and skips its parity", () => {
    const diagnostics = diagnosticsOf({
      "locales/en.json": '{ "a": "A" }',
      "locales/it.json": "{ not json",
      "locales/de.json": '{ "a": "A" }',
    });
    expect(diagnostics.filter((entry) => entry.code === "i18n-catalog")).toHaveLength(1);
    expect(diagnostics.filter((entry) => entry.code === I18N_LOCALE_PARITY_CODE)).toEqual([]);
  });

  it("reports the shipped examples' dynamic and parity warnings only", () => {
    const apps = shippedApps();
    expect(apps.length, "no app under examples/").toBeGreaterThan(0);
    const counts: string[] = [];
    const findings: string[] = [];
    for (const app of apps) {
      const analysis = analyzeProject({ files: loadProjectFiles(app), parser: PARSER });
      const dynamic = analysis.diagnostics.filter((entry) => entry.code === I18N_DYNAMIC_KEY_CODE);
      const parity = analysis.diagnostics.filter((entry) => entry.code === I18N_LOCALE_PARITY_CODE);
      const name = app.slice(REPO_ROOT.length + 1);
      counts.push(name + "=dynamic:" + dynamic.length + ",parity:" + parity.length);
      for (const finding of [...dynamic, ...parity]) {
        if (finding.severity !== "warning") findings.push(name + ": " + finding.severity);
      }
    }
    expect(findings, "i18n findings must warn, never error").toEqual([]);
    // Visible in CI output so the counts are reported instead of silently tolerated.
    console.info("[i18n] shipped examples: " + counts.join(", "));
  });
});
