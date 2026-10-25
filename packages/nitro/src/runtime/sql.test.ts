import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "./sql.ts";

describe("splitSqlStatements", () => {
  it("splits drizzle-kit statement breakpoints", () => {
    const sql = [
      "CREATE TABLE todos (id uuid primary key);",
      "--> statement-breakpoint",
      "CREATE POLICY todos_tenant ON todos;",
    ].join("\n");
    expect(splitSqlStatements(sql)).toEqual([
      "CREATE TABLE todos (id uuid primary key);",
      "CREATE POLICY todos_tenant ON todos;",
    ]);
  });

  it("falls back to end-of-line semicolons", () => {
    expect(splitSqlStatements("CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n")).toEqual([
      "CREATE TABLE a (id int)",
      "CREATE TABLE b (id int)",
    ]);
  });

  it("drops empty and comment-only chunks", () => {
    expect(splitSqlStatements("\n-- just a comment\n\n")).toEqual([]);
  });
});
