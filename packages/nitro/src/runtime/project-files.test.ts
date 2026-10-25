import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectLocaleCatalogs, collectSchemaFiles, readTextFile } from "./project-files.ts";

const projectRoot = fileURLToPath(new URL("../../test-fixtures/project", import.meta.url));

describe("collectSchemaFiles", () => {
  it("returns db/schema.ts and its relative imports, path-sorted", async () => {
    const files = await collectSchemaFiles(projectRoot);
    expect(files.map((file) => file.path)).toEqual(["db/schema.ts", "db/todos.ts"]);
    expect(files[0]?.content).toContain('export * from "./todos"');
  });

  it("returns an empty list when the project has no schema", async () => {
    expect(
      await collectSchemaFiles(
        fileURLToPath(new URL("../../test-fixtures/missing", import.meta.url)),
      ),
    ).toEqual([]);
  });
});

describe("collectLocaleCatalogs", () => {
  it("reads locales/*.json into the catalogs shape", async () => {
    expect(await collectLocaleCatalogs(projectRoot)).toEqual({
      en: { "todos.title": "Title" },
    });
  });

  it("returns {} when there is no locales directory", async () => {
    expect(
      await collectLocaleCatalogs(
        fileURLToPath(new URL("../../test-fixtures/missing", import.meta.url)),
      ),
    ).toEqual({});
  });
});

describe("readTextFile", () => {
  it("returns null instead of throwing for missing files", async () => {
    expect(await readTextFile("/definitely/not/a/file.ts")).toBeNull();
  });
});
