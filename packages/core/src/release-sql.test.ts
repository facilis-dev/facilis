import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "./release-sql.ts";

describe("splitSqlStatements", () => {
  it("splits on statement boundaries and ignores trailing whitespace", () => {
    expect(
      splitSqlStatements("CREATE TABLE a (id int);\n\nALTER TABLE a ADD COLUMN b text;  "),
    ).toEqual(["CREATE TABLE a (id int)", "ALTER TABLE a ADD COLUMN b text"]);
  });

  it("does not split inside literals, comments or dollar-quoted bodies", () => {
    const source = [
      "-- a comment; with a semicolon",
      "INSERT INTO notes (body) VALUES ('a; b');",
      "/* block; comment */",
      "CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql;",
    ].join("\n");
    const statements = splitSqlStatements(source);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a; b'");
    expect(statements[1]).toContain("$$ BEGIN PERFORM 1; END $$");
  });

  it("returns an empty list for an empty file", () => {
    expect(splitSqlStatements("  -- only a comment\n")).toEqual([]);
  });
});
