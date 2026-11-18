import { describe, expect, it } from "vitest";

import { validatePatch } from "./index";
import { locate, jsonSources } from "./rules/json-parse.ts";
import type { FilePatch } from "./types.ts";

const GOOD = '{\n  "app.title": "Facilis italic",\n  "app.subtitle": "Starter"\n}\n';
const TRAILING_COMMA = '{\n  "app.title": "Facilis italic",\n  "app.subtitle": "Starter",\n}\n';
const MISSING_VALUE = '{\n  "app.title": "Facilis italic",\n  "app.subtitle": ,\n}\n';

function jsonFindings(patches: FilePatch[]) {
  return validatePatch(patches).errors.filter((entry) => entry.rule === "json-parse");
}

describe("json-parse", () => {
  it("refuses a catalogue the client imports, naming the file", () => {
    const result = validatePatch([
      { path: "locales/it.json", action: "create", content: TRAILING_COMMA },
    ]);

    expect(result.ok).toBe(false);
    const [finding] = jsonFindings([
      { path: "locales/it.json", action: "create", content: TRAILING_COMMA },
    ]);
    expect(finding?.file).toBe("locales/it.json");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("not valid JSON");
    expect(finding?.fix_hint).toContain("strict JSON");
  });

  it("covers a JSON module outside the catalogues", () => {
    const [finding] = jsonFindings([
      { path: "src/data/seed.json", action: "create", content: MISSING_VALUE },
    ]);

    expect(finding?.file).toBe("src/data/seed.json");
  });

  it("normalizes the path it reports", () => {
    const [finding] = jsonFindings([
      { path: "./locales/it.json", action: "update", content: TRAILING_COMMA },
    ]);

    expect(finding?.file).toBe("locales/it.json");
  });

  it("accepts a catalogue that parses", () => {
    const result = validatePatch([
      { path: "locales/en.json", action: "update", content: GOOD },
      { path: "locales/it.json", action: "create", content: GOOD },
    ]);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("drops a leading BOM, as Vite does", () => {
    const result = validatePatch([
      { path: "locales/it.json", action: "create", content: "\uFEFF" + GOOD },
    ]);

    expect(result.ok).toBe(true);
  });

  it("ignores files that are not JSON", () => {
    const result = validatePatch([
      { path: "src/notes.txt", action: "create", content: "not json" },
    ]);

    expect(result.ok).toBe(true);
  });

  it("ignores a deletion", () => {
    expect(jsonSources([{ path: "locales/it.json", action: "delete" }])).toHaveLength(0);
  });
});

describe("locate", () => {
  it("reads the offset a parser puts in the message", () => {
    expect(locate('{\n  "a": ,\n}\n', "Unexpected token ',' in JSON at position 9")).toEqual({
      line: 2,
      column: 8,
    });
  });

  it("prefers the line and column the parser reports", () => {
    expect(
      locate("{}", "Expected double-quoted property name in JSON at position 64 (line 4 column 1)"),
    ).toEqual({ line: 4, column: 1 });
  });

  it("says nothing when the parser reports no position", () => {
    expect(locate("{}", "Unexpected end of JSON input")).toEqual({});
  });
});
