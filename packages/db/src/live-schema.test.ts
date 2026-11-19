import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { liveSchemaSnapshot, type LiveSchemaSnapshot } from "./live-schema.ts";
import { applyStatements } from "./migrator.ts";

const POLICY = `CREATE POLICY tenant_isolation ON items AS RESTRICTIVE FOR ALL USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
) WITH CHECK (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
)`;

describe("liveSchemaSnapshot", () => {
  let db: FacilisDb;
  let snapshot: LiveSchemaSnapshot;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      `CREATE TABLE items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        title varchar(120) NOT NULL,
        done boolean NOT NULL DEFAULT false,
        note text,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX items_title_idx ON items (title)",
      "ALTER TABLE items ENABLE ROW LEVEL SECURITY",
      POLICY,
    ]);
    snapshot = await liveSchemaSnapshot(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("lists ordinary tables of the current schema only", () => {
    expect(snapshot.tables.map((table) => table.name)).toEqual(["items"]);
  });

  it("reports columns with catalog type, nullability, default and primary key", () => {
    const table = snapshot.tables[0];
    if (table === undefined) throw new Error("items table missing");
    const byName = new Map(table.columns.map((column) => [column.name, column]));

    expect(byName.get("id")).toEqual({
      name: "id",
      type: "uuid",
      notNull: true,
      default: "gen_random_uuid()",
      isPrimaryKey: true,
    });
    expect(byName.get("title")).toMatchObject({
      type: "character varying(120)",
      notNull: true,
      default: null,
      isPrimaryKey: false,
    });
    expect(byName.get("note")).toMatchObject({ type: "text", notNull: false });
    expect(byName.get("created_at")).toMatchObject({
      type: "timestamp with time zone",
      notNull: true,
      default: "now()",
    });
  });

  it("reports row-level security and the policies attached to a table", () => {
    const table = snapshot.tables[0];
    if (table === undefined) throw new Error("items table missing");

    expect(table.rlsEnabled).toBe(true);
    expect(table.policies).toHaveLength(1);
    expect(table.policies[0]).toMatchObject({
      name: "tenant_isolation",
      command: "ALL",
      restrictive: true,
      roles: ["public"],
    });
    expect(table.policies[0]?.using).toContain("tenant_id");
    expect(table.policies[0]?.withCheck).toContain("tenant_id");
  });
});

describe("liveSchemaSnapshot on an empty database", () => {
  it("returns no tables instead of failing", async () => {
    const db = await createDb();
    try {
      await expect(liveSchemaSnapshot(db)).resolves.toEqual({ tables: [] });
    } finally {
      await db.close();
    }
  });
});

describe("liveSchemaSnapshot constraints", () => {
  let db: FacilisDb;
  let snapshot: LiveSchemaSnapshot;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      `CREATE TABLE parents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        label text NOT NULL UNIQUE
      )`,
      `CREATE TABLE children (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
        title text NOT NULL,
        score integer NOT NULL DEFAULT 0,
        CONSTRAINT children_score_ck CHECK (score >= 0)
      )`,
      "CREATE INDEX children_title_idx ON children (title)",
      "CREATE UNIQUE INDEX children_title_unique_idx ON children (title)",
      "CREATE INDEX children_title_lower_idx ON children (lower(title))",
    ]);
    snapshot = await liveSchemaSnapshot(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  function tableNamed(name: string) {
    const table = snapshot.tables.find((entry) => entry.name === name);
    if (table === undefined) throw new Error(`${name} table missing`);
    return table;
  }

  it("reads plain, unique and expression indexes, not constraint backing indexes", () => {
    expect(tableNamed("children").indexes).toEqual([
      { name: "children_title_idx", columns: ["title"], unique: false, expression: null },
      {
        name: "children_title_lower_idx",
        columns: [],
        unique: false,
        expression: "lower(title)",
      },
      { name: "children_title_unique_idx", columns: ["title"], unique: true, expression: null },
    ]);
    // The PK and the label UNIQUE constraint back indexes of their own; the snapshot models
    // those as column flags, so they must not surface as declaration-level indexes.
    expect(tableNamed("parents").indexes).toEqual([]);
  });

  it("reads foreign keys with columns, target and actions", () => {
    expect(tableNamed("children").foreignKeys).toEqual([
      {
        name: "children_parent_id_fkey",
        columns: ["parent_id"],
        targetTable: "parents",
        targetColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ]);
    expect(tableNamed("parents").foreignKeys).toEqual([]);
  });

  it("reads checks with the catalog-rendered expression", () => {
    const checks = tableNamed("children").checks;
    expect(checks).toHaveLength(1);
    expect(checks[0]?.name).toBe("children_score_ck");
    expect(checks[0]?.expression).toContain("score >= 0");
  });
});

