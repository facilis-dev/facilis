import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadProjectFiles } from "./fs.ts";

function write(root: string, path: string, source: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

describe("loadProjectFiles framework scope (D-199)", () => {
  it("loads an installed framework package's dist, not the project's build output", () => {
    const root = mkdtempSync(join(tmpdir(), "facilis-fs-"));
    try {
      write(root, "server/routes/api/todos.get.ts", "export default null;\n");
      write(root, "dist/built.js", "export const built = 1;\n");
      write(root, "node_modules/@facilis.dev/auth/package.json", '{"name":"@facilis.dev/auth"}');
      write(
        root,
        "node_modules/@facilis.dev/auth/dist/index.js",
        'export const TABLES = ["users"];\n',
      );
      write(
        root,
        "node_modules/@facilis.dev/auth/dist/index.d.ts",
        "export declare const TABLES: readonly string[];\n",
      );
      write(root, "node_modules/other/dist/index.js", "export const hidden = 1;\n");
      const files = loadProjectFiles(root);
      expect(files.has("server/routes/api/todos.get.ts")).toBe(true);
      expect(files.has("dist/built.js")).toBe(false);
      expect(files.has("node_modules/@facilis.dev/auth/dist/index.js")).toBe(true);
      expect(files.has("node_modules/@facilis.dev/auth/dist/index.d.ts")).toBe(true);
      expect(files.has("node_modules/other/dist/index.js")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps loading framework src when the install ships it (workspace dev)", () => {
    const root = mkdtempSync(join(tmpdir(), "facilis-fs-"));
    try {
      write(root, "node_modules/@facilis.dev/db/package.json", '{"name":"@facilis.dev/db"}');
      write(root, "node_modules/@facilis.dev/db/src/index.ts", "export const users = null;\n");
      write(root, "node_modules/@facilis.dev/db/dist/index.js", "export const users = null;\n");
      const files = loadProjectFiles(root);
      expect(files.has("node_modules/@facilis.dev/db/src/index.ts")).toBe(true);
      expect(files.has("node_modules/@facilis.dev/db/dist/index.js")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
