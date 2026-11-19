// The schema-planner surface `@facilis.dev/core` exposes: the release generator, the SQL
// renderers the dev boot reuses (D-158/D-193, so a table created at boot and one created by a
// release artifact cannot drift) and the dev consent file contract. Kept as a barrel so
// index.ts stays inside the 300-line limit.

export { planSchema } from "./plan.ts";
export {
  addCheckSql,
  addColumnSql,
  addForeignKeySql,
  createIndexSql,
  createPolicySql,
  createTableSql,
  dropColumnSql,
  dropConstraintSql,
  dropDefaultSql,
  dropIndexSql,
  dropTableSql,
  enableRlsSql,
  quote,
  quoteLiteral,
  setDefaultSql,
} from "./render.ts";
export type {
  SchemaPlan,
  SchemaPlanBatch,
  SchemaPlanProblem,
  SchemaPlanProblemCode,
} from "./types.ts";
export {
  parseSchemaApprovals,
  SCHEMA_APPROVALS_PATH,
  schemaApprovalsJson,
} from "../dev-approvals.ts";
