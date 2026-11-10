import type { PlanContext } from "./diff-helpers.ts";
import type { SchemaPlanProblem, SchemaPlanProblemCode } from "./types.ts";

/** Builds a problem, dropping absent fields so the machine shape stays minimal. */
export function planProblem(
  code: SchemaPlanProblemCode,
  fields: { table?: string; column?: string; construct?: string },
): SchemaPlanProblem {
  return {
    code,
    ...(fields.table === undefined ? {} : { table: fields.table }),
    ...(fields.column === undefined ? {} : { column: fields.column }),
    ...(fields.construct === undefined ? {} : { construct: fields.construct }),
  };
}

/** Appends a problem to the plan being built. */
export function addProblem(
  context: PlanContext,
  code: SchemaPlanProblemCode,
  fields: { table?: string; column?: string; construct?: string },
): void {
  context.problems.push(planProblem(code, fields));
}
