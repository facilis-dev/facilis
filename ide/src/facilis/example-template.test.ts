import { describe, expect, it } from "vitest";
import { examplePackageJson, exampleProjectFiles } from "./example-template";
import { createFacilisTemplate, type FacilisManifest } from "./facilis-template";
import { HMR_HINT } from "./template-overrides";

const example = exampleProjectFiles();
const template = createFacilisTemplate();
const files = template.files;

describe("example project source", () => {
  it("reads the todo-app client, server, schema and locales", () => {
    expect(Object.keys(example)).toEqual(
      expect.arrayContaining([
        "src/app.tsx",
        "src/main.tsx",
        "src/lib/api.ts",
        "src/lib/utils.ts",
        "src/styles.css",
        "server/routes/api/todos/[id].patch.ts",
        "db/schema.ts",
        "db/migrations/0001_seed_roles.sql",
        "locales/en.json",
        "locales/it.json",
        "index.html",
        ".gitignore",
        "vite.config.ts",
        "facilis.config.ts",
      ]),
    );
  });

  it("skips test files and the example's own package.json/tsconfig", () => {
    expect(Object.keys(example).some((path) => path.includes(".test."))).toBe(false);
    expect(example).not.toHaveProperty("package.json");
    expect(example).not.toHaveProperty("tsconfig.json");
  });

  it("reads the package.json the generated one is built from", () => {
    const pkg = JSON.parse(examplePackageJson()) as { dependencies: Record<string, string> };
    // Template v2 copies its UI primitives into src/components/ui: the v1 kit is gone.
    expect(pkg.dependencies["@facilis/ui"]).toBeUndefined();
    expect(pkg.dependencies["@base-ui/react"]).toBeTruthy();
    expect(pkg.dependencies["react-router-dom"]).toBeTruthy();
  });
});

// The generated project IS examples/todo-app (D-062). These assertions are the drift
// guard: changing the example must reach the template untouched, except for the small,
// explicit overrides below.
describe("generated template", () => {
  const OVERRIDES = new Set(["src/app.tsx", "src/styles.css", "facilis.config.ts"]);

  it("carries every example file, with untouched files byte-identical", () => {
    for (const [path, source] of Object.entries(example)) {
      expect(files[path], "missing " + path).toBeDefined();
      if (!OVERRIDES.has(path)) expect(files[path], path).toBe(source);
    }
  });

  it("keeps the smoke's HMR hint and ships no probe instrumentation", () => {
    // The smoke drives the framework endpoints from the IDE page (smoke-facilis.mjs), so a
    // user's starter must stay the example: no probe module, no auto-registration hook.
    expect(files["src/app.tsx"]).toContain(HMR_HINT);
    expect(files["src/app.tsx"]).not.toContain("runProbe");
    expect(files).not.toHaveProperty("src/lib/probe.ts");
    // The one IDE-only route is the liveness ping the write smoke edits.
    expect(files["server/routes/api/ping.get.ts"]).toContain("async () => ({ ok: true })");
  });

  it("gives the VM the in-process Nitro runner and a runnable release ref", () => {
    const config = files["facilis.config.ts"];
    expect(config).toContain('nitro: { devServer: { runner: "self" } }');
    expect(config).toContain('release: { ref: "main" }');
    // Everything else is the example's config.
    expect(config).toContain("roles: {");
    expect(config).toContain('locales: ["en", "it"]');
  });

  it("keeps the v2 Tailwind entry and appends the HMR hint in plain CSS", () => {
    // The example stylesheet is verbatim except for the appended IDE hint: v2 starts with
    // the Tailwind v4 import, and the hint pins only the class name the smoke replaces.
    expect(files["src/styles.css"]).toContain('@import "tailwindcss";');
    expect(files["src/styles.css"]).toContain(".muted {");
    // No v1 @facilis/ui tokens: the v2 template does not define them.
    expect(files["src/styles.css"]).not.toContain("var(--space-4)");
    expect(files["src/styles.css"]).not.toContain("var(--pad-page)");
    expect(files["src/styles.css"]).not.toContain("var(--color-base-content)");
  });

  it("keeps the run manifest pointing at the example's entry", () => {
    expect(template.manifest.entry).toBe("src/app.tsx");
    // analyze, auth, core, db, nitro, time — @facilis/ui is no longer shipped.
    expect((template.manifest as FacilisManifest).assets).toHaveLength(6);
  });

  it("declares every @facilis package as a vendored tarball", () => {
    const pkg = JSON.parse(files["package.json"]) as {
      dependencies: Record<string, string>;
    };
    for (const name of ["analyze", "auth", "core", "db", "nitro", "time"]) {
      expect(pkg.dependencies["@facilis/" + name]).toBe(
        "file:./vendor/facilis-" + name + "-0.0.0.tgz",
      );
    }
    expect(pkg.dependencies["@facilis/ui"]).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toContain("workspace:");
    const assets = (template.manifest as FacilisManifest).assets;
    expect(assets.some((asset) => asset.path.includes("facilis-ui-"))).toBe(false);
  });
});
