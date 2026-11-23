import { describe, expect, it } from "vitest";
import { setConfigPrerenderRoute, setVitePrerenderRoute } from "./prerender-declaration";

const CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  release: { ref: "origin/main" },
  i18n: { defaultLocale: "en", locales: ["en", "it"] },
});
`;

const CONFIG_WITH_SECTION = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  prerender: { routes: ["/about"] },
  i18n: { defaultLocale: "en", locales: ["en", "it"] },
});
`;

const VITE = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
});
`;

const VITE_WITH_PLUGIN = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { prerender } from "@facilis.dev/nitro/prerender";

export default defineConfig({
  plugins: [prerender({ routes: ["/about"] }), react()],
});
`;

describe("setConfigPrerenderRoute", () => {
  it("inserts a prerender section into defineConfig when none exists", () => {
    const next = setConfigPrerenderRoute(CONFIG, "/about", true);
    expect(next).not.toBeNull();
    expect(next).toContain('prerender: { routes: ["/about"] },');
    // Everything else is preserved byte for byte.
    expect(next).toContain('release: { ref: "origin/main" },');
    expect(next).toContain('i18n: { defaultLocale: "en", locales: ["en", "it"] },');
  });

  it("adds a route to an existing inline array and keeps the style", () => {
    const next = setConfigPrerenderRoute(CONFIG_WITH_SECTION, "/pricing", true);
    expect(next).toContain('prerender: { routes: ["/about", "/pricing"] },');
  });

  it("removes a route and keeps an empty allowlist (off by default)", () => {
    const next = setConfigPrerenderRoute(CONFIG_WITH_SECTION, "/about", false);
    expect(next).toContain("prerender: { routes: [] },");
  });

  it("is a no-op when enabling an already-declared route", () => {
    expect(setConfigPrerenderRoute(CONFIG_WITH_SECTION, "/about", true)).toBe(CONFIG_WITH_SECTION);
  });

  it("is a no-op when disabling a route that is not declared", () => {
    expect(setConfigPrerenderRoute(CONFIG_WITH_SECTION, "/nope", false)).toBe(CONFIG_WITH_SECTION);
    expect(setConfigPrerenderRoute(CONFIG, "/about", false)).toBe(CONFIG);
  });

  it("preserves a multiline array's one-entry-per-line style", () => {
    const source = CONFIG_WITH_SECTION.replace(
      'prerender: { routes: ["/about"] },',
      'prerender: {\n    routes: [\n      "/about",\n      "/docs",\n    ],\n  },',
    );
    const next = setConfigPrerenderRoute(source, "/pricing", true);
    expect(next).toContain('      "/pricing",');
    expect(next).toContain('      "/about",');
    const removed = setConfigPrerenderRoute(source, "/about", false);
    expect(removed).not.toContain('"/about"');
    expect(removed).toContain('"/docs"');
  });

  it("keeps single-quoted arrays single-quoted", () => {
    const source = CONFIG_WITH_SECTION.replace('["/about"]', "['/about']");
    const next = setConfigPrerenderRoute(source, "/pricing", true);
    expect(next).toContain("['/about', '/pricing']");
  });

  it("preserves an origin field next to routes", () => {
    const source = CONFIG_WITH_SECTION.replace(
      'prerender: { routes: ["/about"] },',
      'prerender: { routes: ["/about"], origin: "https://example.com" },',
    );
    const next = setConfigPrerenderRoute(source, "/about", false);
    expect(next).toContain('origin: "https://example.com"');
    expect(next).toContain("routes: []");
  });

  it("ignores the word prerender inside comments and strings", () => {
    const source = CONFIG.replace(
      "export default defineConfig({",
      '// prerender: { routes: ["/fake"] }\nconst note = \'prerender: { routes: ["/fake"] }\';\nexport default defineConfig({',
    );
    const next = setConfigPrerenderRoute(source, "/about", true);
    expect(next).toContain('prerender: { routes: ["/about"] },');
    expect(next).toContain('// prerender: { routes: ["/fake"] }');
  });

  it("fails closed without a defineConfig object", () => {
    expect(setConfigPrerenderRoute("export const x = 1;\n", "/about", true)).toBeNull();
  });

  it("fails closed on two prerender sections", () => {
    const source = CONFIG_WITH_SECTION.replace("i18n:", "prerender: { routes: [] },\n  i18n:");
    expect(setConfigPrerenderRoute(source, "/about", true)).toBeNull();
  });

  it("fails closed on a non-string routes array", () => {
    const source = CONFIG_WITH_SECTION.replace('["/about"]', "[...OTHER_ROUTES]");
    expect(setConfigPrerenderRoute(source, "/pricing", true)).toBeNull();
  });
});

describe("setVitePrerenderRoute", () => {
  it("adds the import and the plugin call when neither exists", () => {
    const next = setVitePrerenderRoute(VITE, "/about", true);
    expect(next).not.toBeNull();
    expect(next).toContain('import { prerender } from "@facilis.dev/nitro/prerender";');
    expect(next).toContain('plugins: [prerender({ routes: ["/about"] }), react()],');
    expect(next).toContain("server: { port: 3000 },");
  });

  it("adds a route to the existing plugin call", () => {
    const next = setVitePrerenderRoute(VITE_WITH_PLUGIN, "/pricing", true);
    expect(next).toContain('prerender({ routes: ["/about", "/pricing"] })');
  });

  it("removes a route from the plugin call", () => {
    const next = setVitePrerenderRoute(VITE_WITH_PLUGIN, "/about", false);
    expect(next).toContain("prerender({ routes: [] })");
  });

  it("honours an aliased import", () => {
    const source = VITE_WITH_PLUGIN.replace(
      "import { prerender }",
      "import { prerender as prerenderPlugin }",
    ).replace("plugins: [prerender(", "plugins: [prerenderPlugin(");
    const next = setVitePrerenderRoute(source, "/pricing", true);
    expect(next).toContain('prerenderPlugin({ routes: ["/about", "/pricing"] })');
  });

  it("adds the call without duplicating an existing import", () => {
    const source = VITE_WITH_PLUGIN.replace(
      'plugins: [prerender({ routes: ["/about"] }), react()],',
      "plugins: [react()],",
    );
    const next = setVitePrerenderRoute(source, "/pricing", true);
    expect(next).toContain('plugins: [prerender({ routes: ["/pricing"] }), react()],');
    expect(next?.match(/@facilis\.dev\/nitro\/prerender/g)).toHaveLength(1);
  });

  it("is a no-op when disabling with no declaration", () => {
    expect(setVitePrerenderRoute(VITE, "/about", false)).toBe(VITE);
  });

  it("inserts into a multiline plugins array keeping indentation", () => {
    const source = VITE.replace("plugins: [react()],", "plugins: [\n    react(),\n  ],");
    const next = setVitePrerenderRoute(source, "/about", true);
    expect(next).toContain('    prerender({ routes: ["/about"] }),');
    expect(next).toContain("    react(),");
  });

  it("fails closed without a plugins array", () => {
    const source = VITE.replace("plugins: [react()],", "");
    expect(setVitePrerenderRoute(source, "/about", true)).toBeNull();
  });

  it("fails closed on two prerender calls", () => {
    const source = VITE_WITH_PLUGIN.replace(
      'plugins: [prerender({ routes: ["/about"] }), react()],',
      'plugins: [prerender({ routes: ["/about"] }), prerender({ routes: [] }), react()],',
    );
    expect(setVitePrerenderRoute(source, "/pricing", true)).toBeNull();
  });

  it("does not treat a local function named prerender as the framework declaration", () => {
    const source = VITE.replace(
      "export default defineConfig({",
      "function prerender(opts: unknown) { return opts; }\nexport default defineConfig({",
    ).replace("plugins: [react()],", "plugins: [prerender({ routes: [] }), react()],");
    // No framework import: the enable adds the real import and a second call would be
    // ambiguous with the local one, so the write must fail closed rather than guess.
    const next = setVitePrerenderRoute(source, "/about", true);
    expect(next).toBeNull();
  });
});
