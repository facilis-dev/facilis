import { describe, expect, it } from "vitest";

import { isAllowedWritePath } from "./paths.ts";

describe("isAllowedWritePath", () => {
  it("defaults to the managed roots (fail-closed)", () => {
    expect(isAllowedWritePath("src/App.tsx")).toBe(true);
    expect(isAllowedWritePath("facilis.config.ts")).toBe(true);
    expect(isAllowedWritePath(".github/workflows/deploy.yml")).toBe(false);
    expect(isAllowedWritePath("wrangler.jsonc")).toBe(false);
  });

  it("keeps the six roots plus facilis.config.ts under managed", () => {
    for (const path of [
      "server/routes/api/todos/index.get.ts",
      "src/App.tsx",
      "db/schema.ts",
      "lib/format.ts",
      "components/Card.tsx",
      "locales/en.json",
      "facilis.config.ts",
    ]) {
      expect(isAllowedWritePath(path, "managed"), path).toBe(true);
    }
    for (const path of ["index.html", "vite.config.ts", "README.md", "package.json"]) {
      expect(isAllowedWritePath(path, "managed"), path).toBe(false);
    }
  });

  it("allows the whole project, root config and CI under open", () => {
    for (const path of [
      "server/routes/api/todos/index.get.ts",
      "src/App.tsx",
      "db/schema.ts",
      "lib/format.ts",
      "components/Card.tsx",
      "locales/en.json",
      "facilis.config.ts",
      "index.html",
      "vite.config.ts",
      "wrangler.jsonc",
      ".github/workflows/deploy.yml",
      ".github/actions/setup/action.yml",
      "README.md",
      ".nvmrc",
    ]) {
      expect(isAllowedWritePath(path, "open"), path).toBe(true);
    }
  });

  it("denies the install, VCS/IDE and build surfaces under open", () => {
    for (const path of [
      "node_modules/react/index.js",
      "src/node_modules/injected.ts",
      "package.json",
      "server/package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      ".npmrc",
      "AGENTS.md",
      ".git/config",
      ".facilis/facilis.app.json",
      "dist/assets/app.js",
      ".turbo/cache/x",
      "coverage/lcov.info",
    ]) {
      expect(isAllowedWritePath(path, "open"), path).toBe(false);
    }
  });
});
