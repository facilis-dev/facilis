import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { createOxcParser } from "../node.ts";
import { IMPORT_CYCLE_CODE, MAX_CYCLE_PATH_ENTRIES } from "./import-cycle.ts";

const PARSER = createOxcParser();

function cycles(files: Record<string, string>) {
  return analyzeProject({
    files: new Map(Object.entries(files)),
    parser: PARSER,
  }).diagnostics.filter((entry) => entry.code === IMPORT_CYCLE_CODE);
}

describe("import cycles (D-217)", () => {
  it("warns once for A -> B -> A and names the cycle", () => {
    const found = cycles({
      "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain('"a.ts" -> "b.ts" -> "a.ts"');
    expect(found[0]?.source).toEqual({ file: "a.ts", line: 1 });
  });

  it("stays silent on an acyclic graph", () => {
    expect(
      cycles({
        "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
        "b.ts": 'import { c } from "./c.ts";\nexport const b = c;\n',
        "c.ts": "export const c = 1;\n",
      }),
    ).toEqual([]);
  });

  it("reports a self-import as a one-node cycle", () => {
    const found = cycles({ "a.ts": 'import { a } from "./a.ts";\nexport const a = a;\n' });
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("self-import");
    expect(found[0]?.message).toContain('"a.ts" -> "a.ts"');
  });

  it("lists the other members when the first file also self-imports", () => {
    const found = cycles({
      "a.ts": 'import "./a.ts";\nimport { b } from "./b.ts";\nexport const a = b;\n',
      "b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('"a.ts" -> "b.ts" -> "a.ts"');
  });

  it("excludes framework and node_modules overlays", () => {
    expect(
      cycles({
        "app.ts": 'import { auth } from "@facilis.dev/auth";\nexport const app = auth;\n',
        "node_modules/@facilis.dev/auth/package.json": JSON.stringify({
          exports: { ".": "./src/index.ts" },
        }),
        "node_modules/@facilis.dev/auth/src/index.ts": 'export * from "./state.ts";\n',
        "node_modules/@facilis.dev/auth/src/state.ts": 'export * from "./index.ts";\n',
      }),
    ).toEqual([]);
  });

  it("emits one diagnostic per component, ordered by path", () => {
    const found = cycles({
      "c.ts": 'import { d } from "./d.ts";\nexport const c = d;\n',
      "d.ts": 'import { c } from "./c.ts";\nexport const d = c;\n',
      "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
    });
    expect(found.map((entry) => entry.source?.file)).toEqual(["a.ts", "c.ts"]);
  });

  it("caps the listed path and reports the remaining segments", () => {
    const length = 12;
    const files: Record<string, string> = {};
    for (let index = 0; index < length; index += 1) {
      const next = (index + 1) % length;
      files["f" + index + ".ts"] =
        'import "./f' + next + '.ts";\nexport const v' + index + " = 1;\n";
    }
    const found = cycles(files);
    expect(found).toHaveLength(1);
    const message = found[0]?.message ?? "";
    expect(message).toContain("(5 more)");
    expect(message).not.toContain('"f8.ts"');
    expect(message.split(" -> ").length).toBe(MAX_CYCLE_PATH_ENTRIES + 1);
  });
});
