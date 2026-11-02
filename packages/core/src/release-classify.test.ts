import { describe, expect, it } from "vitest";

import { classifyStatement } from "./release-classify.ts";

describe("classifyStatement", () => {
  const cases: Array<[string, string, string]> = [
    ['CREATE TABLE "todos" (id uuid PRIMARY KEY)', "add_table", "safe"],
    ['DROP TABLE IF EXISTS "todos"', "drop_table", "destructive"],
    ['ALTER TABLE "todos" ADD COLUMN done boolean', "add_column", "safe"],
    ["ALTER TABLE todos ADD COLUMN done boolean NOT NULL", "add_column", "careful"],
    ["ALTER TABLE todos ADD COLUMN done boolean NOT NULL DEFAULT false", "add_column", "safe"],
    ["ALTER TABLE todos DROP COLUMN title", "drop_column", "destructive"],
    ["ALTER TABLE todos ALTER COLUMN title TYPE varchar(20)", "alter_column", "destructive"],
    ["ALTER TABLE todos ALTER COLUMN title SET DEFAULT 'x'", "alter_column", "careful"],
    ["ALTER TABLE todos RENAME COLUMN title TO name", "alter_column", "careful"],
    ["CREATE INDEX todos_owner_idx ON todos (owner_id)", "add_index", "safe"],
    ["CREATE UNIQUE INDEX todos_slug_idx ON todos (slug)", "add_index", "careful"],
    ["DROP INDEX todos_owner_idx", "drop_index", "careful"],
    ["CREATE POLICY tenant_isolation ON todos USING (tenant_id = 1)", "add_policy", "safe"],
    ["ALTER POLICY tenant_isolation ON todos USING (tenant_id = 2)", "alter_policy", "careful"],
    ["DROP POLICY tenant_isolation ON todos", "drop_policy", "destructive"],
    ["ALTER TABLE todos ENABLE ROW LEVEL SECURITY", "other", "safe"],
    ["ALTER TABLE todos DISABLE ROW LEVEL SECURITY", "other", "destructive"],
    [
      "ALTER TABLE todos ADD CONSTRAINT fk FOREIGN KEY (owner_id) REFERENCES users(id)",
      "add_fk",
      "careful",
    ],
    ["INSERT INTO roles (name) VALUES ('admin')", "other", "safe"],
  ];

  it.each(cases)("%s -> %s (%s)", (sql, kind, risk) => {
    const verdict = classifyStatement(sql);
    expect(verdict.kind).toBe(kind);
    expect(verdict.risk).toBe(risk);
  });

  it("extracts the affected table and column", () => {
    const verdict = classifyStatement('ALTER TABLE "todos" DROP COLUMN "title"');
    expect(verdict.affectedTable).toBe("todos");
    expect(verdict.affectedColumns).toEqual(["title"]);
  });
});
