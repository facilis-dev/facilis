import type { RiskClass } from "../release.ts";
import type { SchemaPlanBatch } from "./types.ts";

/** A batch before the final, order-derived id is assigned. */
export interface BatchDraft {
  slug: string;
  sql: string;
  risk: RiskClass;
  requires?: string[];
}

const RISK_ORDER: Readonly<Record<RiskClass, number>> = {
  safe: 0,
  careful: 1,
  destructive: 2,
  breaking: 3,
};

/** Highest risk of the plan; never `breaking` because the planner never emits it. */
export function maxRisk(batches: readonly { risk: RiskClass }[]): RiskClass {
  let risk: RiskClass = "safe";
  for (const batch of batches) {
    if (RISK_ORDER[batch.risk] > RISK_ORDER[risk]) risk = batch.risk;
  }
  return risk;
}

/** Lower-case slug for an id: identifiers keep `_`, everything else collapses to `-`. */
export function slug(...parts: readonly string[]): string {
  const text = parts
    .map((part) => part.toLowerCase().replaceAll(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((part) => part.length > 0)
    .join("-");
  return text.length === 0 ? "step" : text;
}

/** Assigns the stable order-derived ids and returns the public batches. */
export function finalizeBatches(drafts: readonly BatchDraft[]): SchemaPlanBatch[] {
  return drafts.map((entry, index) => ({
    id: `${String(index + 1).padStart(3, "0")}-${entry.slug}`,
    sql: entry.sql,
    risk: entry.risk,
    ...(entry.requires === undefined ? {} : { requires: entry.requires }),
  }));
}
