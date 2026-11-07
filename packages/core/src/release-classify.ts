// Risk classification of the SQL a release ships (SPEC §11.3): each statement gets
// safe / careful / destructive, and a conservative unfamiliar ALTER is "careful".
// The engine lifts a destructive drop to "breaking" when routes still use the entity.

import type { MigrationStatementKind, RiskClass } from "./release.ts";
import { stripComments, unquote } from "./release-sql.ts";

/** Risk verdict for one SQL statement, before the route cross-check runs. */
export interface StatementClassification {
  readonly kind: MigrationStatementKind;
  readonly risk: RiskClass;
  readonly affectedTable: string | null;
  readonly affectedColumns: readonly string[];
  readonly reason: string;
}

const IDENT = String.raw`(?:"[^"]+"|[\w$]+)`;
const QUALIFIED = /((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/;

function match(expression: RegExp, text: string): RegExpExecArray | null {
  return expression.exec(text);
}

function tableFrom(value: string | undefined): string | null {
  return value === undefined ? null : unquote(value);
}

/** Classify one statement against the spec's risk table (SPEC §11.3). */
export function classifyStatement(sql: string): StatementClassification {
  const text = stripComments(sql).replace(/\s+/g, " ").trim();
  return classifyNormalized(text);
}

function classifyNormalized(text: string): StatementClassification {
  const createTable = match(
    new RegExp(
      `^create\\s+(?:unlogged\\s+|temp(?:orary)?\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED.source}`,
      "i",
    ),
    text,
  );
  if (createTable !== null) {
    return verdict(
      "add_table",
      "safe",
      tableFrom(createTable[1]),
      [],
      "creates a new table; nothing existing is touched",
    );
  }
  const dropTable = match(
    new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?${QUALIFIED.source}`, "i"),
    text,
  );
  if (dropTable !== null) {
    return verdict(
      "drop_table",
      "destructive",
      tableFrom(dropTable[1]),
      [],
      "drops a table and its rows",
    );
  }
  const alterTable = match(
    new RegExp(
      `^alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${QUALIFIED.source}\\s+([\\s\\S]*)$`,
      "i",
    ),
    text,
  );
  if (alterTable !== null) {
    return classifyAlter(tableFrom(alterTable[1]), alterTable[2] ?? "");
  }
  const createIndex = /^create\s+(unique\s+)?index/i.exec(text);
  if (createIndex !== null) {
    const unique = createIndex[1] !== undefined;
    return verdict(
      "add_index",
      unique ? "careful" : "safe",
      null,
      [],
      unique
        ? "adds a UNIQUE index: existing duplicate rows fail the migration"
        : "adds an index; table rows are not rewritten",
    );
  }
  if (/^drop\s+index/i.test(text)) {
    return verdict("drop_index", "careful", null, [], "drops an index; queries lose the fast path");
  }
  const createPolicy = match(
    new RegExp(`^create\\s+policy\\s+${IDENT}\\s+on\\s+${QUALIFIED.source}`, "i"),
    text,
  );
  if (createPolicy !== null) {
    return verdict("add_policy", "safe", tableFrom(createPolicy[1]), [], "adds an RLS policy");
  }
  const alterPolicy = match(
    new RegExp(`^alter\\s+policy\\s+${IDENT}\\s+on\\s+${QUALIFIED.source}`, "i"),
    text,
  );
  if (alterPolicy !== null) {
    return verdict(
      "alter_policy",
      "careful",
      tableFrom(alterPolicy[1]),
      [],
      "changes an existing RLS policy",
    );
  }
  const dropPolicy = match(
    new RegExp(
      `^drop\\s+policy\\s+(?:if\\s+exists\\s+)?${IDENT}\\s+on\\s+${QUALIFIED.source}`,
      "i",
    ),
    text,
  );
  if (dropPolicy !== null) {
    return verdict(
      "drop_policy",
      "destructive",
      tableFrom(dropPolicy[1]),
      [],
      "drops an RLS policy: access broadens",
    );
  }
  if (/^disable\s+row\s+level\s+security/i.test(text)) {
    return verdict("other", "destructive", null, [], "disables row level security");
  }
  return verdict("other", "safe", null, [], "statement does not change table data or structure");
}

function classifyAlter(table: string | null, rest: string): StatementClassification {
  if (/^add\s+constraint/i.test(rest)) {
    return verdict(
      "add_fk",
      "careful",
      table,
      [],
      "adds a constraint: existing rows must already satisfy it",
    );
  }
  if (/^drop\s+constraint/i.test(rest)) {
    return verdict("drop_fk", "careful", table, [], "drops a constraint");
  }
  if (/^disable\s+row\s+level\s+security/i.test(rest)) {
    return verdict("other", "destructive", table, [], "disables row level security");
  }
  if (/^enable\s+row\s+level\s+security/i.test(rest)) {
    return verdict("other", "safe", table, [], "enables row level security");
  }
  const addColumn = match(
    new RegExp(`^add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?${IDENT}`, "i"),
    rest,
  );
  if (addColumn !== null) {
    const column = unquote(
      addColumn[0].replace(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?/i, ""),
    );
    const nullable = /\bnot\s+null\b/i.test(rest) && !/\bdefault\b/i.test(rest);
    return verdict(
      "add_column",
      nullable ? "careful" : "safe",
      table,
      [column],
      nullable
        ? "adds a NOT NULL column without a default: existing rows need a backfill"
        : "adds a column without rewriting existing rows",
    );
  }
  const dropColumn = match(
    new RegExp(`^drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?${IDENT}`, "i"),
    rest,
  );
  if (dropColumn !== null) {
    const column = unquote(dropColumn[0].replace(/^drop\s+(?:column\s+)?(?:if\s+exists\s+)?/i, ""));
    return verdict("drop_column", "destructive", table, [column], "drops a column and its data");
  }
  const renameColumn = match(
    new RegExp(`^rename\\s+(?:column\\s+)?${IDENT}\\s+to\\s+${IDENT}`, "i"),
    rest,
  );
  if (renameColumn !== null) {
    return verdict(
      "alter_column",
      "careful",
      table,
      [],
      "renames a column: every query that names it must change",
    );
  }
  const alterColumn = match(
    new RegExp(`^alter\\s+(?:column\\s+)?${IDENT}\\s+([\\s\\S]*)$`, "i"),
    rest,
  );
  if (alterColumn !== null) {
    const column = unquote(
      alterColumn[0].replace(/^alter\s+(?:column\s+)?/i, "").replace(/\s+[\s\S]*$/, ""),
    );
    const destructive = /\btype\b|set\s+data\s+type|set\s+not\s+null/i.test(alterColumn[1] ?? "");
    return verdict(
      "alter_column",
      destructive ? "destructive" : "careful",
      table,
      [column],
      destructive
        ? "changes a column type or nullability: existing rows are rewritten or rejected"
        : "changes a column default or attribute",
    );
  }
  return verdict(
    "alter_column",
    "careful",
    table,
    [],
    "unrecognised ALTER TABLE: review the statement",
  );
}

function verdict(
  kind: MigrationStatementKind,
  risk: RiskClass,
  affectedTable: string | null,
  affectedColumns: readonly string[],
  reason: string,
): StatementClassification {
  return { kind, risk, affectedTable, affectedColumns, reason };
}
