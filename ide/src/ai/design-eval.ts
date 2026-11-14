// The design eval: a fixed suite and a deterministic rubric (D-185, DESIGN.md §11 P3).
//
// The design block costs prompt tokens on every turn, so "did the page come out right?" has
// to be answerable without a human reading screenshots. This module is that answer: six
// cases, six binary criteria derived from the rules the prompt states, scored over the
// returned patches. It is pure — the live model calls live in scripts/dev/design-eval.mjs —
// so the rubric itself runs in CI.

import type { FilePatch } from "@facilis.dev/ai";
import { scanPatchWarnings } from "./patch-warnings";

export interface DesignEvalCase {
  id: string;
  /** The user turn, sent verbatim. */
  prompt: string;
  /** What this case is here to catch, one line. */
  note: string;
}

export const DESIGN_EVAL_CASES: readonly DesignEvalCase[] = [
  {
    id: "dashboard",
    prompt:
      "Create a dashboard page at /reports with four headline numbers and the latest rows. Keep it read-only.",
    note: "the page anatomy: header, stat row, table, no invented shell",
  },
  {
    id: "list-create",
    prompt:
      "Add a page at /projects that lists the projects as a table and lets me create one from a form on the same page.",
    note: "list + create: table, toolbar, form on the page, four states",
  },
  {
    id: "settings-form",
    prompt:
      "Add a settings page at /settings where I can edit my display name and time zone, with inline validation.",
    note: "form rules: Field + Label, inline error, pending state",
  },
  {
    id: "auth",
    prompt: "Add a page at /accept-invite that takes an invite code and joins the workspace.",
    note: "an auth-shaped screen with a single primary action",
  },
  {
    id: "empty",
    prompt: "Add an empty state to the projects page for when there are no projects yet.",
    note: "EmptyState with the action that fixes the emptiness",
  },
  {
    id: "error",
    prompt: "Show a retryable error on the projects page when the list request fails.",
    note: "Alert + retry, no toast for a list failure",
  },
];

export type DesignCriterion =
  "page-shell" | "tokens" | "states" | "dependencies" | "motion" | "copy";

export interface CriterionResult {
  criterion: DesignCriterion;
  pass: boolean;
  /** The first offending path or symbol, so the summary is actionable. */
  detail: string;
}

export interface DesignScore {
  criteria: readonly CriterionResult[];
  passed: number;
  total: number;
  /** Review-time warnings across the patch set (never a failure by themselves). */
  warnings: number;
  files: number;
}

const PAGE_ROOT = "src/pages/";
const PAGE_EXCEPTION = "not-found.tsx";
const MOTION_MODULES = ["motion", "framer-motion", "gsap", "lottie-web", "rive", "three"];
const BANNED_COPY = ["seamless", "powerful", "effortlessly"];

const IMPORT_SPECIFIER = /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*["']([^"']+)["']/g;

function live(patches: readonly FilePatch[]): readonly { patch: FilePatch; content: string }[] {
  return patches.flatMap((patch) =>
    patch.action !== "delete" && typeof patch.content === "string"
      ? [{ patch, content: patch.content }]
      : [],
  );
}

function pages(entries: readonly { patch: FilePatch; content: string }[]) {
  return entries.filter(
    ({ patch }) =>
      patch.path.startsWith(PAGE_ROOT) &&
      patch.path.endsWith(".tsx") &&
      !patch.path.endsWith(PAGE_EXCEPTION),
  );
}

function importsOf(content: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [IMPORT_SPECIFIER, SIDE_EFFECT_IMPORT]) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function isLocal(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("~/");
}

function copyViolation(content: string): string | null {
  let catalogue: Record<string, unknown>;
  try {
    catalogue = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return "locales file is not valid JSON";
  }
  for (const [key, value] of Object.entries(catalogue)) {
    if (typeof value !== "string") continue;
    if (value.includes("!")) return key + ": exclamation mark";
    const lowered = value.toLowerCase();
    const banned = BANNED_COPY.find((word) => lowered.includes(word));
    if (banned !== undefined) return key + ": " + banned;
  }
  return null;
}

/**
 * Score one answer against the rubric. `deps` is the template's own dependency set: an import
 * that is neither local nor declared is a dependency the patch cannot install.
 */
export function scoreDesignAnswer(
  patches: readonly FilePatch[],
  deps: ReadonlySet<string>,
): DesignScore {
  const entries = live(patches);
  const produced = pages(entries);
  const warnings = scanPatchWarnings(patches);
  const criteria: CriterionResult[] = [];

  const shell = produced.find(({ content }) => !content.includes("<Page"));
  criteria.push({
    criterion: "page-shell",
    pass: produced.length > 0 && shell === undefined,
    detail:
      produced.length === 0
        ? "no page produced"
        : shell === undefined
          ? ""
          : shell.patch.path + " does not render <Page>",
  });

  const tokenWarning = warnings.find(
    (warning) =>
      warning.rule === "raw-color" ||
      warning.rule === "palette-class" ||
      warning.rule === "arbitrary-value",
  );
  criteria.push({
    criterion: "tokens",
    pass: tokenWarning === undefined,
    detail: tokenWarning === undefined ? "" : tokenWarning.symbol + " in " + tokenWarning.path,
  });

  const fetches = (content: string) => content.includes("api<") || content.includes("fetch(");
  const missing = produced.find(
    ({ content }) =>
      fetches(content) &&
      !(
        content.includes("Skeleton") &&
        content.includes("EmptyState") &&
        content.includes("Alert")
      ),
  );
  criteria.push({
    criterion: "states",
    pass: missing === undefined,
    detail: missing === undefined ? "" : missing.patch.path + " misses a loading/empty/error state",
  });

  const declared = (specifier: string) =>
    [...deps].some((dep) => specifier === dep || specifier.startsWith(dep + "/"));
  const externals = entries.flatMap(({ patch, content }) =>
    importsOf(content)
      .filter((specifier) => !isLocal(specifier) && !declared(specifier))
      .map((specifier) => ({ specifier, path: patch.path })),
  );
  const touchedManifest = patches.some((patch) => patch.path === "package.json");
  criteria.push({
    criterion: "dependencies",
    pass: externals.length === 0 && !touchedManifest,
    detail: touchedManifest
      ? "patch writes package.json"
      : externals.length === 0
        ? ""
        : externals[0]?.specifier + " in " + externals[0]?.path,
  });

  const motion = entries.flatMap(({ patch, content }) =>
    importsOf(content)
      .filter((specifier) => MOTION_MODULES.includes(specifier.split("/")[0] ?? ""))
      .map((specifier) => ({ specifier, path: patch.path })),
  );
  criteria.push({
    criterion: "motion",
    pass: motion.length === 0,
    detail: motion.length === 0 ? "" : motion[0]?.specifier + " in " + motion[0]?.path,
  });

  const badCopy = entries
    .filter(({ patch }) => patch.path.startsWith("locales/") && patch.path.endsWith(".json"))
    .map(({ patch, content }) => ({ path: patch.path, issue: copyViolation(content) }))
    .find((entry) => entry.issue !== null);
  criteria.push({
    criterion: "copy",
    pass: badCopy === undefined,
    detail: badCopy === undefined ? "" : badCopy.path + ": " + badCopy.issue,
  });

  return {
    criteria,
    passed: criteria.filter((criterion) => criterion.pass).length,
    total: criteria.length,
    warnings: warnings.length,
    files: entries.length,
  };
}
