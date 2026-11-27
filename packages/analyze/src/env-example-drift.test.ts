/**
 * D-224 drift gate: the committed `.env.example` files are exactly what the renderer generates
 * from the project's own config. They are tooling output, never hand-written; editing one
 * without regenerating it fails here.
 *
 * This lives in `packages/analyze` because its gates run in CI without the IDE (the runtime
 * requirements gate beside it takes the same approach).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { defineConfig, renderEnvExample, type FacilisConfig } from "@facilis.dev/core";

/** Walk up from this file so the gate does not depend on the process cwd. */
function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate the repo root from " + import.meta.url);
    current = parent;
  }
}

const REPO_ROOT = repositoryRoot();

async function loadExampleConfig(name: string): Promise<FacilisConfig> {
  const loaded: unknown = await import(
    pathToFileURL(join(REPO_ROOT, "examples", name, "facilis.config.ts")).href
  );
  if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
    throw new Error(`examples/${name} has no default export`);
  }
  return (loaded as { default: FacilisConfig }).default;
}

describe(".env.example drift gate (D-224)", () => {
  for (const name of ["starter-app", "todo-app"]) {
    it("matches renderEnvExample for examples/" + name, async () => {
      const committed = readFileSync(join(REPO_ROOT, "examples", name, ".env.example"), "utf8");
      const generated = renderEnvExample(defineConfig(await loadExampleConfig(name)));
      expect(committed).toBe(generated);
    });
  }
});
