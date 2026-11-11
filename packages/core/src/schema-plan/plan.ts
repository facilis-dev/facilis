import type { SchemaSnapshot } from "@facilis.dev/db";

import { planConstraints, planIndexes, planSecurity } from "./diff-constraints.ts";
import { createContext } from "./diff-helpers.ts";
import { planObsoleteDrops } from "./diff-drops.ts";
import {
  planAlterColumns,
  planCreates,
  planDeclarationProblems,
  planDestructiveDrops,
} from "./diff-snapshot.ts";
import { finalizeBatches, maxRisk } from "./draft.ts";
import type { SchemaPlan } from "./types.ts";

/**
 * The pure generator (docs/MIGRATION-PLAN.md §2.5): two declared snapshots in, the ordered
 * SQL batches of a release artifact out. No database is read or written; the deploy side
 * applies the batches (P3) and the release pipeline stores them (P4).
 *
 * Phase order is fixed: obsolete drops, CREATE TYPE/TABLE + added columns, no data batches
 * in v1, column tightening, unique/check/FK constraints, RLS + policies, indexes, seed is a
 * deploy post-step, destructive drops last.
 */
export function planSchema(from: SchemaSnapshot, to: SchemaSnapshot): SchemaPlan {
  const context = createContext(from, to);

  planDeclarationProblems(context);
  planObsoleteDrops(context);
  planCreates(context);
  planAlterColumns(context);
  planConstraints(context);
  planSecurity(context);
  planIndexes(context);
  planDestructiveDrops(context);

  // Fail closed: a plan with any problem is not a partial plan, it is no plan at all.
  if (context.problems.length > 0) {
    return { batches: [], risk: "safe", destructive: [], problems: context.problems };
  }

  const batches = finalizeBatches(context.drafts);
  return {
    batches,
    risk: maxRisk(batches),
    destructive: batches.filter((batch) => batch.risk === "destructive").map((batch) => batch.id),
    problems: [],
  };
}
