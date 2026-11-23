/**
 * Integration proof for the prerender engine (issue #83 acceptance): real builds of both
 * template fixtures through createBuilder + buildApp — the CLI path; the programmatic
 * vite.build() API uses the legacy builder and never runs buildApp hooks.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBuilder } from "vite";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(PACKAGE_ROOT, "test-fixtures");
const STATIC_ROOT = resolve(FIXTURES, "prerender-static");
const FULLSTACK_ROOT = resolve(FIXTURES, "prerender-fullstack");
const CONFIG_PATH = resolve(FULLSTACK_ROOT, "facilis.config.ts");

/**
 * The fixture resolves the framework through a real re-export shim, never a symlink back
 * into the package: every example links @facilis.dev/nitro to this package, and the
 * analyzer walks that scope — a self-symlink here would be an ELOOP cycle from any project.
 */
function ensureShim(): void {
  const shim = resolve(FIXTURES, "node_modules/@facilis.dev/nitro");
  mkdirSync(shim, { recursive: true });
  // Plain .mjs: Node refuses to type-strip .ts under node_modules; the re-export target
  // (the package src) is outside node_modules and loads through native type stripping.
  writeFileSync(
    resolve(shim, "package.json"),
    JSON.stringify({
      name: "@facilis.dev/nitro",
      type: "module",
      exports: { ".": "./index.mjs", "./prerender": "./prerender.mjs", "./vite": "./vite.mjs" },
    }),
  );
  for (const entry of ["index", "prerender", "vite"]) {
    writeFileSync(resolve(shim, `${entry}.mjs`), `export * from "../../../../src/${entry}.ts";\n`);
  }
  const pglite = resolve(FIXTURES, "node_modules/@electric-sql");
  mkdirSync(pglite, { recursive: true });
  const link = resolve(pglite, "pglite");
  if (!existsSync(link)) {
    symlinkSync(resolve(PACKAGE_ROOT, "../db/node_modules/@electric-sql/pglite"), link, "dir");
  }
}

beforeAll(() => {
  ensureShim();
});

function clean(root: string, dirs: string[]): void {
  for (const dir of dirs) rmSync(resolve(root, dir), { recursive: true, force: true });
}

async function build(root: string): Promise<void> {
  const builder = await createBuilder({ root, logLevel: "silent" });
  await builder.buildApp();
}

describe("static template build", () => {
  afterAll(() => clean(STATIC_ROOT, ["dist", ".facilis"]));

  it("emits per-route HTML, island, canonical, sitemap and the shell", async () => {
    clean(STATIC_ROOT, ["dist", ".facilis"]);
    await build(STATIC_ROOT);
    const about = readFileSync(resolve(STATIC_ROOT, "dist/about/index.html"), "utf8");
    expect(about).toContain("<h1>About</h1>");
    expect(about).toContain("<title>About the Fixture</title>");
    expect(about).toContain('<link rel="canonical" href="https://fixture.example/about"/>');
    expect(about).toContain('id="prerender-data"');
    const home = readFileSync(resolve(STATIC_ROOT, "dist/index.html"), "utf8");
    expect(home).toContain("<h1>Prerendered home</h1>");
    const sitemap = readFileSync(resolve(STATIC_ROOT, "dist/sitemap.xml"), "utf8");
    expect(sitemap).toContain("<loc>https://fixture.example/</loc>");
    expect(sitemap).toContain("<loc>https://fixture.example/about</loc>");
    expect(sitemap.match(/<url>/g)).toHaveLength(2);
    const shell = readFileSync(resolve(STATIC_ROOT, "dist/shell.html"), "utf8");
    expect(shell).toContain('<div id="root"></div>');
    const stamp = JSON.parse(readFileSync(resolve(STATIC_ROOT, ".facilis/prerender.json"), "utf8"));
    expect(stamp.routes).toEqual(["/", "/about"]);
  }, 120_000);
});

describe("full-stack template build", () => {
  const originalConfig = readFileSync(CONFIG_PATH, "utf8");
  const previousCwd = process.cwd();

  afterAll(() => {
    process.chdir(previousCwd);
    writeFileSync(CONFIG_PATH, originalConfig);
    clean(FULLSTACK_ROOT, [".output", ".facilis"]);
  });

  it("prerenders public data over loopback with no identity", async () => {
    clean(FULLSTACK_ROOT, [".output", ".facilis"]);
    // PGlite resolves from the project cwd (the built server's require base).
    process.chdir(FULLSTACK_ROOT);
    await build(FULLSTACK_ROOT);
    const stats = readFileSync(resolve(FULLSTACK_ROOT, ".output/public/stats/index.html"), "utf8");
    expect(stats).toContain("count=42");
    expect(stats).toContain('data-source="prerender"');
    expect(stats).toContain('{"/api/stats":{"count":42,"source":"public-api"}}');
    expect(stats).toContain("<title>Fixture Stats</title>");
    expect(existsSync(resolve(FULLSTACK_ROOT, ".output/public/shell.html"))).toBe(true);
    expect(existsSync(resolve(FULLSTACK_ROOT, ".output/public/sitemap.xml"))).toBe(true);
    const stamp = JSON.parse(readFileSync(resolve(FULLSTACK_ROOT, ".facilis/prerender.json"), "utf8"));
    expect(stamp.routes).toEqual(["/", "/stats"]);
    expect(stamp.outDir).toBe(resolve(FULLSTACK_ROOT, ".output/public"));
  }, 180_000);

  it("fails the build for a declared private-api page (fail closed)", async () => {
    writeFileSync(CONFIG_PATH, originalConfig.replace('routes: ["/", "/stats"]', 'routes: ["/private"]'));
    await expect(build(FULLSTACK_ROOT)).rejects.toThrow(/prerender-ineligible.*private-api/s);
  }, 120_000);

  it("fails the build for a declared route with no page", async () => {
    writeFileSync(CONFIG_PATH, originalConfig.replace('routes: ["/", "/stats"]', 'routes: ["/missing"]'));
    await expect(build(FULLSTACK_ROOT)).rejects.toThrow(/prerender-ineligible/);
  }, 120_000);
});
