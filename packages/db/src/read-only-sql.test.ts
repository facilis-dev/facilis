import { describe, expect, it } from "vitest";

import {
  firstKeyword,
  hasMultipleStatements,
  isReadOnlySql,
  stripTrailingSemicolon,
} from "./read-only-sql.ts";

describe("isReadOnlySql", () => {
  it.each([
    "select 1",
    "SELECT * FROM todos",
    "with x as (select 1) select * from x",
    "values (1)",
    "table todos",
  ])("accepts a single read-only statement: %s", (text) => {
    expect(isReadOnlySql(text)).toBe(true);
  });

  it.each([
    "insert into todos values (1)",
    "update todos set title = 'x'",
    "delete from todos",
    "create table t (id int)",
    "drop table todos",
    "copy todos to stdout",
  ])("rejects a write or DDL statement: %s", (text) => {
    expect(isReadOnlySql(text)).toBe(false);
  });

  it("rejects a second statement after a separator", () => {
    expect(isReadOnlySql("select 1; drop table todos")).toBe(false);
    expect(isReadOnlySql("select 1;select 2")).toBe(false);
  });

  it("allows one trailing semicolon", () => {
    expect(isReadOnlySql("select 1;")).toBe(true);
    expect(isReadOnlySql("select 1;   \n")).toBe(true);
  });

  it("ignores separators inside strings, identifiers, dollar quotes and comments", () => {
    expect(isReadOnlySql("select ';' as s")).toBe(true);
    expect(isReadOnlySql('select ";" as s')).toBe(true);
    expect(isReadOnlySql("select $tag$;$tag$ as s")).toBe(true);
    expect(isReadOnlySql("select 1 -- ; drop table todos")).toBe(true);
    expect(isReadOnlySql("select 1 /* ; drop table todos */")).toBe(true);
    expect(isReadOnlySql("select 1 /* outer /* inner */ still */")).toBe(true);
  });

  it("does not treat a backslash as an escape: a missed quote must never hide a separator", () => {
    // Standard strings do not use backslash escapes, so the string closes at the quote
    // and the second statement is visible to the scanner.
    expect(isReadOnlySql("select 'a\\'; drop table todos")).toBe(false);
  });

  it("rejects an empty or non-statement body", () => {
    expect(isReadOnlySql("")).toBe(false);
    expect(isReadOnlySql("-- just a comment")).toBe(false);
  });
});

describe("firstKeyword", () => {
  it("skips leading comments and whitespace", () => {
    expect(firstKeyword("\n-- note\n/* block */ select 1")).toBe("SELECT");
    expect(firstKeyword("values (1)")).toBe("VALUES");
    expect(firstKeyword("")).toBeNull();
  });
});

describe("hasMultipleStatements", () => {
  it("reports a separator followed by content", () => {
    expect(hasMultipleStatements("select 1; select 2")).toBe(true);
    expect(hasMultipleStatements("select 1;;")).toBe(true);
  });

  it("reports a single trailing separator as one statement", () => {
    expect(hasMultipleStatements("select 1;")).toBe(false);
    expect(hasMultipleStatements("select 1; -- trailing comment")).toBe(false);
  });
});

describe("stripTrailingSemicolon", () => {
  it("removes one trailing semicolon and surrounding whitespace", () => {
    expect(stripTrailingSemicolon(" select 1; \n")).toBe("select 1");
    expect(stripTrailingSemicolon("select 1")).toBe("select 1");
  });
});
