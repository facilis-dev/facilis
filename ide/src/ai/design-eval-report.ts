// The eval report: parsing the model's one JSON object and turning a run into a readable
// summary (DESIGN.md §11 P3). Split from design-eval.ts to stay under the file-length limit;
// pure, so both halves are unit-tested without a provider.

import type { FilePatch } from "@facilis.dev/ai";
import type { DesignScore } from "./design-eval";
export interface DesignAnswer {
  message?: string;
  patches?: readonly FilePatch[];
  notes?: readonly string[];
}

/** The one JSON object the contract asks for, even when the provider wraps it in a fence. */
export function parseDesignAnswer(text: string): DesignAnswer | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return typeof value === "object" && value !== null ? (value as DesignAnswer) : null;
  } catch {
    return null;
  }
}

export interface DesignEvalRow {
  case: string;
  seed: number;
  ms: number;
  tokens: number;
  /** null when the answer did not parse or carried no patches. */
  score: DesignScore | null;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** The report a run leaves behind: per case, per criterion, and every failure with its path. */
export function summarizeDesignEval(
  rows: readonly DesignEvalRow[],
  meta: { model: string; seeds: number },
): string {
  const cases = [...new Set(rows.map((row) => row.case))];
  const criteria = rows.find((row) => row.score !== null)?.score?.criteria ?? [];
  const lines = ["# Design eval", "", `model: ${meta.model} | seeds: ${meta.seeds}`, ""];

  lines.push("| case | pass rate | warnings | out tokens | seconds | unparsed |");
  lines.push("|---|---|---|---|---|---|");
  for (const id of cases) {
    const group = rows.filter((row) => row.case === id);
    const parsed = group.filter(
      (row): row is DesignEvalRow & { score: DesignScore } => row.score !== null,
    );
    const rate =
      parsed.length === 0
        ? "-"
        : fixed(mean(parsed.map((row) => row.score.passed / row.score.total)), 2);
    lines.push(
      "| " +
        id +
        " | " +
        rate +
        " | " +
        fixed(mean(parsed.map((row) => row.score.warnings)), 1) +
        " | " +
        fixed(mean(group.map((row) => row.tokens)), 0) +
        " | " +
        fixed(mean(group.map((row) => row.ms)) / 1000, 1) +
        " | " +
        String(group.length - parsed.length) +
        " |",
    );
  }

  lines.push("", "| criterion | pass rate |", "|---|---|");
  for (const { criterion } of criteria) {
    const results = rows
      .filter((row) => row.score !== null)
      .map((row) => row.score?.criteria.find((entry) => entry.criterion === criterion)?.pass);
    lines.push(
      "| " +
        criterion +
        " | " +
        fixed(mean(results.map((value) => (value === true ? 1 : 0))), 2) +
        " |",
    );
  }

  const failures = rows.flatMap((row) =>
    (row.score?.criteria ?? [])
      .filter((criterion) => !criterion.pass)
      .map(
        (criterion) =>
          "- " + row.case + " #" + row.seed + ": " + criterion.criterion + " — " + criterion.detail,
      ),
  );
  if (failures.length > 0) lines.push("", "## Failures", "", ...failures);
  return lines.join("\n") + "\n";
}
