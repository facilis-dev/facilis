import { describe, expect, it } from "vitest";
import { exampleProjectFiles } from "./example-template";
import { parseSchemaTables } from "./release-schema";

function table(source: string, name: string) {
  const found = parseSchemaTables(source).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name + " missing from the parse");
  return found;
}

describe("parseSchemaTables", () => {
  it("reads the schema the template actually ships", () => {
    const source = exampleProjectFiles()["db/schema.ts"] ?? "";
    const tables = parseSchemaTables(source);
    expect(tables.map((entry) => entry.name)).toEqual(["todos"]);
    expect(table(source, "todos")).toEqual({
      name: "todos",
      columns: ["id", "tenantId", "ownerId", "title", "done", "dueDate", "createdAt"],
      policies: [{ name: "tenant_isolation" }, { name: "owner_isolation" }],
      rlsEnabled: true,
      scoped: true,
    });
  });

  it("expands the @facilis/db policy helpers and named pgPolicy calls", () => {
    const source = `
import { pgTable, pgPolicy, text, uuid } from "drizzle-orm/pg-core";
import { rlsForTable } from "@facilis/db";
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  title: text("title"),
}, () => [
  pgPolicy("documents_read", {} as never),
  rlsForTable({ tenantColumn: "tenant_id", ownerColumn: "owner_id" }).policies,
]);
export const notes = pgTable("notes", { id: uuid("id") });
`;
    const documents = table(source, "documents");
    expect(documents.policies.map((policy) => policy.name)).toEqual([
      "documents_read",
      "tenant_isolation",
      "owner_isolation",
    ]);
    expect(documents.rlsEnabled).toBe(false);
    expect(documents.scoped).toBe(true);
    expect(table(source, "notes")).toMatchObject({ rlsEnabled: false, scoped: false, columns: ["id"] });
  });

  it("ignores commented-out and quoted pgTable lookalikes", () => {
    const source = `
// pgTable("ghost", { id: uuid("id") })
    const hint = 'pgTable("other", { id: uuid("id") })';
/* export const removed = pgTable("removed", { id: uuid("id") }); */
export const real = pgTable("real", { id: uuid("id"), ownerId: uuid("owner_id") });
`;
    expect(parseSchemaTables(source).map((entry) => entry.name)).toEqual(["real"]);
    expect(table(source, "real").scoped).toBe(true);
  });

  it("does not duplicate a table declared twice and survives unbalanced text", () => {
    const duplicate = `
export const first = pgTable("same", { id: uuid("id") });
export const second = pgTable("same", { id: uuid("id") });
`;
    expect(parseSchemaTables(duplicate)).toHaveLength(1);
    expect(parseSchemaTables('export const broken = pgTable("broken", { id: uuid("id")')).toEqual([]);
    expect(parseSchemaTables("")).toEqual([]);
  });
});
