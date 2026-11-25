import { describe, expect, it } from "vitest";

import { describeStatement } from "./describe-statement.ts";

describe("describeStatement", () => {
  it("names the verb and the relation of a plain read", () => {
    expect(describeStatement('select "users"."id" from "users" where "id" = $1')).toEqual({
      operation: "select",
      relation: "users",
    });
  });

  it("reads the target of inserts, updates and deletes", () => {
    expect(describeStatement("insert into documents (id) values ($1)")).toEqual({
      operation: "insert",
      relation: "documents",
    });
    expect(describeStatement("update documents set title = $1 where id = $2")).toEqual({
      operation: "update",
      relation: "documents",
    });
    expect(describeStatement("delete from documents where id = $1")).toEqual({
      operation: "delete",
      relation: "documents",
    });
  });

  it("takes the first relation of a join and strips a schema prefix", () => {
    expect(
      describeStatement(
        "select * from public.documents d left join audit_log a on a.document_id = d.id",
      ),
    ).toEqual({ operation: "select", relation: "documents" });
  });

  it("never reads a relation out of a string literal or a comment", () => {
    expect(describeStatement("select 'from secrets' as label, id from live_documents")).toEqual({
      operation: "select",
      relation: "live_documents",
    });
    expect(describeStatement("insert into audit (note) values ('into fake')")).toEqual({
      operation: "insert",
      relation: "audit",
    });
    expect(describeStatement("select id -- from not_a_table\nfrom real_documents")).toEqual({
      operation: "select",
      relation: "real_documents",
    });
    expect(describeStatement("/* from nowhere */ select * from documents")).toEqual({
      operation: "select",
      relation: "documents",
    });
  });

  it("omits a relation it cannot read without guessing", () => {
    expect(describeStatement("select * from (select * from documents) t")).toEqual({
      operation: "select",
      relation: null,
    });
    expect(describeStatement("select * from only_later()")).toEqual({
      operation: "select",
      relation: null,
    });
  });

  it("reads a quoted relation, including one that is not a plain identifier", () => {
    expect(describeStatement('select * from "Odd Table"')).toEqual({
      operation: "select",
      relation: "Odd Table",
    });
    expect(describeStatement('select * from public."documents"')).toEqual({
      operation: "select",
      relation: "documents",
    });
  });

  it("reports transaction control without a relation", () => {
    expect(describeStatement("begin")).toEqual({ operation: "begin", relation: null });
    expect(describeStatement("commit")).toEqual({ operation: "commit", relation: null });
  });

  it('collapses an unknown verb to "other" so attribute cardinality stays bounded', () => {
    expect(describeStatement("listen my_channel")).toEqual({ operation: "other", relation: null });
  });

  it("is empty rather than wrong for an empty statement", () => {
    expect(describeStatement("")).toEqual({ operation: "other", relation: null });
  });
});
