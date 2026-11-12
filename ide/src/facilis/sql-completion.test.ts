import { describe, expect, it } from "vitest";
import {
  SQL_KEYWORDS,
  completionContext,
  referencedTables,
  sqlCompletions,
  type SqlCompletion,
  type SqlTable,
} from "./sql-completion";

const TABLES: readonly SqlTable[] = [
  { name: "todos", columns: ["id", "title", "completed"] },
  { name: "users", columns: ["id", "email", "name"] },
];

function complete(
  text: string,
  offset: number = text.length,
  tables: readonly SqlTable[] = TABLES,
): SqlCompletion[] {
  return sqlCompletions({ text, offset, tables });
}

function byLabel(items: readonly SqlCompletion[], label: string): SqlCompletion {
  const found = items.find((item) => item.label === label);
  if (found === undefined) throw new Error("missing completion: " + label);
  return found;
}

describe("sqlCompletions", () => {
  it("offers the keyword catalogue in a general context, even with no schema", () => {
    const items = complete("", 0, []);
    expect(items.map((item) => item.label)).toEqual([...SQL_KEYWORDS]);
    expect(items.every((item) => item.kind === "keyword")).toBe(true);
  });

  it("keeps keywords available inside a table clause", () => {
    const items = complete("SELECT * FROM ");
    expect(byLabel(items, "todos").kind).toBe("table");
    expect(byLabel(items, "SELECT").kind).toBe("keyword");
  });

  it("suggests tables after JOIN and UPDATE", () => {
    expect(byLabel(complete("SELECT * FROM todos JOIN "), "users").kind).toBe("table");
    expect(byLabel(complete("UPDATE "), "todos").kind).toBe("table");
  });

  it("ranks referenced tables above unreferenced ones and keywords last", () => {
    const items = complete("SELECT * FROM todos JOIN ");
    expect(byLabel(items, "todos").sortText < byLabel(items, "users").sortText).toBe(true);
    expect(byLabel(items, "users").sortText < byLabel(items, "SELECT").sortText).toBe(true);
  });

  it("suggests columns after WHERE, referenced tables' columns first", () => {
    const items = complete("SELECT * FROM todos WHERE ");
    expect(byLabel(items, "title").kind).toBe("column");
    expect(byLabel(items, "title").detail).toBe("todos");
    expect(byLabel(items, "email").detail).toBe("users");
    expect(byLabel(items, "title").sortText < byLabel(items, "email").sortText).toBe(true);
  });

  it("uses tables named later in the statement when completing after SELECT", () => {
    const items = complete("SELECT  FROM todos", "SELECT ".length);
    expect(byLabel(items, "title").detail).toBe("todos");
  });

  it("offers qualified forms for referenced tables", () => {
    const items = complete("SELECT * FROM todos WHERE ");
    expect(byLabel(items, "todos.title").kind).toBe("column");
    expect(byLabel(items, "todos.title").insertText).toBe("todos.title");
  });

  it("narrows to one table's columns after a qualifier", () => {
    const items = complete("SELECT * FROM todos WHERE todos.");
    expect(items.map((item) => item.label)).toEqual(["id", "title", "completed"]);
    expect(items.every((item) => item.insertText === item.label)).toBe(true);
    expect(byLabel(items, "title").detail).toBe("todos");
  });

  it("returns nothing for an unknown qualifier instead of unrelated candidates", () => {
    expect(complete("SELECT * FROM todos WHERE nope.")).toEqual([]);
  });

  it("dedupes column names case-insensitively but keeps qualified forms", () => {
    const tables: readonly SqlTable[] = [
      { name: "todos", columns: ["id", "Title"] },
      { name: "lists", columns: ["ID", "title"] },
    ];
    const text = "SELECT * FROM todos JOIN lists WHERE ";
    const items = complete(text, text.length, tables);
    expect(items.filter((item) => item.label.toLowerCase() === "id")).toHaveLength(1);
    expect(items.filter((item) => item.label.toLowerCase() === "title")).toHaveLength(1);
    expect(byLabel(items, "todos.Title").kind).toBe("column");
    expect(byLabel(items, "lists.title").kind).toBe("column");
  });

  it("treats GROUP BY and ORDER BY as column contexts", () => {
    expect(byLabel(complete("SELECT * FROM todos GROUP BY "), "title").kind).toBe("column");
    expect(byLabel(complete("SELECT * FROM todos ORDER BY "), "completed").kind).toBe("column");
  });

  it("degrades to keywords when the schema is empty", () => {
    const items = complete("SELECT * FROM todos WHERE ", undefined, []);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.kind === "keyword")).toBe(true);
  });
});

describe("completionContext", () => {
  it("reads the nearest clause keyword before the cursor", () => {
    expect(completionContext("", 0)).toBe("general");
    expect(completionContext("SELECT ", "SELECT ".length)).toBe("columns");
    expect(completionContext("SELECT * FROM ", "SELECT * FROM ".length)).toBe("tables");
    expect(
      completionContext(
        "SELECT * FROM todos WHERE id = 1 AND ",
        "SELECT * FROM todos WHERE id = 1 AND ".length,
      ),
    ).toBe("columns");
  });
});

describe("referencedTables", () => {
  it("collects tables from FROM/JOIN/UPDATE/INTO, schema-qualified or not", () => {
    expect(referencedTables("SELECT * FROM public.todos t JOIN users ON t.id = users.id")).toEqual([
      "todos",
      "users",
    ]);
    expect(referencedTables("UPDATE todos SET title = 'x'")).toEqual(["todos"]);
    expect(referencedTables("INSERT INTO todos (title) VALUES ('x')")).toEqual(["todos"]);
    expect(referencedTables("DELETE FROM todos WHERE id = 1")).toEqual(["todos"]);
  });

  it("dedupes tables and ignores subqueries, comments and string literals", () => {
    expect(referencedTables("SELECT * FROM todos JOIN todos ON true")).toEqual(["todos"]);
    expect(referencedTables("SELECT * FROM (SELECT 1) x")).toEqual([]);
    expect(referencedTables("SELECT 1 -- FROM nope")).toEqual([]);
    expect(referencedTables("SELECT 'FROM nope'")).toEqual([]);
  });
});
