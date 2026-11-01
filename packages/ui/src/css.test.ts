import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the per-component stylesheet organisation: one CSS file next to its component, no
// component rules in theme.css, and no colour literals outside the token sets.

const srcDir = new URL("./", import.meta.url);
const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const files = readdirSync(srcDir);
const stylesheets = files.filter((file) => file.endsWith(".css")).toSorted();
const components = files
  .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
  .toSorted();

function sourceOf(file: string): string {
  return readFileSync(new URL(file, srcDir), "utf8");
}

/** Stylesheets with no matching .tsx of their own are shared partials. */
const SHARED_STYLESHEETS = new Set(["icon-button.css"]);

describe("stylesheet organisation", () => {
  it("imports its colocated stylesheet from the component module", () => {
    for (const stylesheet of stylesheets) {
      if (SHARED_STYLESHEETS.has(stylesheet)) continue;
      const component = stylesheet.replace(/\.css$/, ".tsx");
      if (!components.includes(component)) {
        throw new Error(stylesheet + " has no colocated " + component);
      }
      expect(sourceOf(component), component + " must import " + stylesheet).toContain(
        'import "./' + stylesheet + '";',
      );
    }
  });

  it("imports every stylesheet from at least one module", () => {
    const sources = components.map(sourceOf);
    for (const stylesheet of stylesheets) {
      const imported = sources.some((source) => source.includes('import "./' + stylesheet + '";'));
      expect(imported, stylesheet + " is never imported").toBe(true);
    }
  });

  it("keeps theme.css to the token sets and the global base layer", () => {
    expect(theme).not.toMatch(/\.fc-/);
    expect(theme).toContain('@import "@fontsource-variable/geist/index.css";');
    expect(theme).toContain("box-sizing: border-box;");
    expect(theme).toContain("body {");
    expect(theme).toContain(":focus-visible {");
  });

  it("uses only theme tokens in component styles", () => {
    const tokens = new Set(
      [...theme.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] as string),
    );

    for (const stylesheet of stylesheets) {
      const source = sourceOf(stylesheet);
      expect(source, stylesheet + " contains a colour literal").not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|(?:oklch|rgba?|hsla?)\(/,
      );
      for (const match of source.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        expect(tokens, stylesheet + " references undefined token " + match[1]).toContain(match[1]);
      }
    }
  });
});
