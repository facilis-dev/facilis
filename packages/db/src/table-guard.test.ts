import { eq, sql } from "drizzle-orm";
import { alias, integer, pgTable, pgView, serial, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { guardDatabase, TableAccessError } from "./table-guard.ts";

const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
});

const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
});

// A view is its own relation (D-097/D-098), never its base table.
const activeUsers = pgView("active_users", {
  id: integer("id"),
  name: text("name"),
}).existing();

let db: FacilisDb;

beforeAll(async () => {
  db = await createDb({ schema: { users, posts } });
  await applyStatements(db, [
    "CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL)",
    "CREATE TABLE posts (id serial PRIMARY KEY, user_id integer NOT NULL, title text NOT NULL)",
    "CREATE TABLE accounts (id serial PRIMARY KEY, email text NOT NULL)",
    "INSERT INTO users (name) VALUES ('ada'), ('grace')",
    "INSERT INTO posts (user_id, title) VALUES (1, 'hello')",
    "INSERT INTO accounts (email) VALUES ('a@example.com')",
    "CREATE VIEW active_users AS SELECT id, name FROM users",
  ]);
}, 30_000);

afterAll(async () => {
  await db.close();
});

function caught(run: () => unknown): TableAccessError {
  try {
    run();
  } catch (error) {
    if (error instanceof TableAccessError) return error;
    throw error;
  }
  throw new Error("expected a TableAccessError");
}

describe("guardDatabase", () => {
  it("runs allowed selects and joins", async () => {
    const guarded = guardDatabase(db.db, { declared: ["users", "posts"] });
    const rows = await guarded
      .select({ name: users.name, title: posts.title })
      .from(users)
      .leftJoin(posts, eq(users.id, posts.userId));

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.name === "ada")?.title).toBe("hello");
  });

  it("runs allowed inserts, updates and deletes", async () => {
    const guarded = guardDatabase(db.db, { declared: ["users"] });
    const inserted = await guarded
      .insert(users)
      .values({ name: "linus" })
      .returning({ id: users.id });
    const id = inserted[0]?.id;
    expect(id).toBeTypeOf("number");
    if (id === undefined) throw new Error("insert returned no id");

    const updated = await guarded
      .update(users)
      .set({ name: "linus-2" })
      .where(eq(users.id, id))
      .returning({ name: users.name });
    expect(updated).toEqual([{ name: "linus-2" }]);

    const deleted = await guarded.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    expect(deleted).toEqual([{ id }]);
  });

  it("runs the relational API and checks its relation", async () => {
    const guarded = guardDatabase(db.db, { declared: ["users"] });
    const relational = guarded as unknown as {
      query: { users: { findMany: () => Promise<{ name: string }[]> } };
    };

    const rows = await relational.query.users.findMany();
    expect(rows.map((row) => row.name)).toContain("ada");
  });

  it("resolves an aliased table to its declared original name", async () => {
    const guarded = guardDatabase(db.db, { declared: ["users"] });
    const u = alias(users, "u");

    const rows = await guarded.select({ id: u.id, name: u.name }).from(u);
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(["ada", "grace"]));
  });

  it("treats a view as its own relation, not its base table", async () => {
    const guarded = guardDatabase(db.db, { declared: ["active_users"] });
    const rows = await guarded
      .select({ id: activeUsers.id, name: activeUsers.name })
      .from(activeUsers);
    expect(rows.length).toBeGreaterThan(0);

    expect(caught(() => guarded.select().from(users)).code).toBe("table_not_declared");
  });

  it("throws before execution for an undeclared relation", () => {
    const guarded = guardDatabase(db.db, { declared: ["users"] });
    const before = db.activity();

    const error = caught(() => guarded.select().from(accounts));

    expect(error.code).toBe("table_not_declared");
    expect(error.relation).toBe("accounts");
    expect(db.activity()).toBe(before);
  });

  it("refuses db.execute unless rawSql is allowed", async () => {
    const denied = guardDatabase(db.db, { declared: [] });
    expect(caught(() => denied.execute(sql`select 1`)).code).toBe("raw_sql_not_allowed");

    const allowed = guardDatabase(db.db, { declared: [], allowRawSql: true });
    const result = await allowed.execute(sql`select 1 as ok`);
    expect(result.rows).toHaveLength(1);
  });

  it("observes every declared relation and stays awaitable through then", async () => {
    const seen: string[] = [];
    const guarded = guardDatabase(db.db, {
      declared: ["users", "posts"],
      onRelation: (relation) => seen.push(relation),
    });

    const rows = await guarded
      .select({ name: users.name })
      .from(users)
      .leftJoin(posts, eq(users.id, posts.userId))
      .then((result) => result);

    expect(rows).toHaveLength(2);
    expect(seen).toEqual(expect.arrayContaining(["users", "posts"]));
  });

  it("refuses the raw client escape hatches", () => {
    const guarded = guardDatabase(db.db, { declared: [] }) as unknown as Record<string, unknown>;
    expect(caught(() => guarded["$client"]).code).toBe("raw_sql_not_allowed");
    expect(caught(() => guarded["session"]).code).toBe("raw_sql_not_allowed");
  });

  it("guards the transaction callback it hands out", async () => {
    const guarded = guardDatabase(db.db, { declared: ["users"] });

    const count = await guarded.transaction(async (tx) => {
      const rows = await tx.select().from(users);
      return rows.length;
    });

    expect(count).toBeGreaterThanOrEqual(2);
    await expect(
      guarded.transaction(async (tx) => tx.select().from(accounts)),
    ).rejects.toBeInstanceOf(TableAccessError);
  });
});
