import { describe, expect, it } from "vitest";

import { createModuleGraph } from "./module-graph.ts";
import { localInitializer } from "./module-info.ts";
import { createOxcParser } from "./node.ts";
import { evaluateStatic } from "./static-eval.ts";

function setup(source: string) {
  const graph = createModuleGraph({
    files: new Map([["a.ts", source]]),
    parser: createOxcParser(),
  });
  const file = graph.file("a.ts");
  if (file === undefined) throw new Error("missing fixture");
  return { graph, file };
}

describe("evaluateStatic", () => {
  it("evaluates literals, arrays, objects and TS wrappers", () => {
    const source = [
      'const tables = ["todos"] as const;',
      "const config = { dbTables: tables, permission: 'todos:read' } as const;",
    ].join("\n");
    const { graph, file } = setup(source);
    const initializer = localInitializer(file.program, "config");
    const result = evaluateStatic(initializer, { graph, file: "a.ts" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ dbTables: ["todos"], permission: "todos:read" });
  });

  it("evaluates templates and string concatenation", () => {
    const source = 'const path = "/api/" + "todos" + "/";';
    const { graph, file } = setup(source);
    const result = evaluateStatic(localInitializer(file.program, "path"), {
      graph,
      file: "a.ts",
    });
    expect(result).toEqual({ ok: true, value: "/api/todos/" });
  });

  it("evaluates numeric arithmetic used in config defaults", () => {
    const source = "const week = 1000 * 60 * 60 * 24 * 7;";
    const { graph, file } = setup(source);
    expect(evaluateStatic(localInitializer(file.program, "week"), { graph, file: "a.ts" })).toEqual(
      {
        ok: true,
        value: 604800000,
      },
    );
  });

  it("rejects calls and environment reads", () => {
    const source = "const config = { dbTables: process.env.TABLES };";
    const { graph, file } = setup(source);
    const result = evaluateStatic(localInitializer(file.program, "config"), {
      graph,
      file: "a.ts",
    });
    expect(result.ok).toBe(false);
  });
});
