import { describe, expect, it } from "vitest";
import {
  ANALYSIS_MAX_FILES,
  ANALYSIS_MAX_TOTAL_CHARS,
  analysisSizeError,
  isAnalysisPath,
  projectRelativePath,
  selectAnalysisFiles,
} from "./analyze-files";

const ROOT = "/home/user/projects/facilis-app";
const abs = (relative: string): string => ROOT + "/" + relative;

describe("projectRelativePath", () => {
  it("strips the root, with or without a trailing slash", () => {
    expect(projectRelativePath(ROOT, abs("src/app.tsx"))).toBe("src/app.tsx");
    expect(projectRelativePath(ROOT + "/", abs("src/app.tsx"))).toBe("src/app.tsx");
    expect(projectRelativePath("/", "/src/app.tsx")).toBe("src/app.tsx");
  });

  it("rejects paths outside the root and the root itself", () => {
    expect(projectRelativePath(ROOT, "/home/user/projects/other/src/app.tsx")).toBeNull();
    expect(projectRelativePath(ROOT, ROOT)).toBeNull();
    expect(projectRelativePath(ROOT, ROOT + "-sibling/src/app.tsx")).toBeNull();
  });
});

describe("isAnalysisPath", () => {
  it("accepts the DSL surface", () => {
    for (const path of [
      "facilis.config.ts",
      "package.json",
      "tsconfig.json",
      "db/schema.ts",
      "server/routes/api/todos/index.get.ts",
      "src/pages/todos.tsx",
      "src/lib/api.mjs",
      "locales/en.json",
      "node_modules/@facilis.dev/core/src/index.ts",
      "node_modules/@facilis.dev/db/package.json",
    ]) {
      expect(isAnalysisPath(path), path).toBe(true);
    }
  });

  it("rejects everything the analyzer does not read", () => {
    for (const path of [
      "vite.config.ts",
      "README.md",
      "src/app.css",
      "src/logo.svg",
      "dist/assets/index.js",
      "src/dist/index.ts",
      ".output/server/index.mjs",
      ".facilis/graph.json",
      "db/schema.test.ts",
      "src/lib/api.spec.ts",
      "node_modules/react/index.js",
      "node_modules/@facilis.dev/core/dist/index.js",
      "node_modules/@facilis.dev/core/node_modules/dep/index.ts",
      "src/node_modules/x/index.ts",
    ]) {
      expect(isAnalysisPath(path), path).toBe(false);
    }
  });
});

describe("selectAnalysisFiles", () => {
  it("returns sorted, de-duplicated project-relative paths", () => {
    const result = selectAnalysisFiles(
      [
        abs("src/pages/todos.tsx"),
        abs("facilis.config.ts"),
        abs("src/pages/todos.tsx"),
        abs("server/routes/api/todos/index.get.ts"),
        abs("README.md"),
        "/elsewhere/src/outside.ts",
      ],
      ROOT,
    );
    expect(result).toEqual({
      ok: true,
      paths: ["facilis.config.ts", "server/routes/api/todos/index.get.ts", "src/pages/todos.tsx"],
    });
  });

  it("returns an empty selection when nothing matches", () => {
    expect(selectAnalysisFiles([abs("README.md")], ROOT)).toEqual({ ok: true, paths: [] });
  });

  it("reports a clear error past the file cap", () => {
    const paths = Array.from({ length: ANALYSIS_MAX_FILES + 1 }, (_, index) =>
      abs("src/file-" + index + ".ts"),
    );
    const result = selectAnalysisFiles(paths, ROOT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a size error");
    expect(result.error).toContain("too large");
    expect(result.error).toContain(String(ANALYSIS_MAX_FILES));
  });
});

describe("analysisSizeError", () => {
  it("passes sizes inside the budget and rejects the first char past it", () => {
    expect(analysisSizeError(0)).toBeNull();
    expect(analysisSizeError(ANALYSIS_MAX_TOTAL_CHARS)).toBeNull();
    expect(analysisSizeError(ANALYSIS_MAX_TOTAL_CHARS + 1)).toContain("too large");
  });
});
