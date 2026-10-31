import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { UI_THEMES, appearanceOf, appearanceOfAttribute } from "./ui-themes";

// The CSS blocks and the components are checked by scripts/check-ide-theme.mjs
// (wired into `pnpm lint`), so this file stays a pure registry test.

describe("theme registry", () => {
  it("registers the two shipped themes with distinct attributes", () => {
    const specs = Object.values(UI_THEMES);
    expect(specs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(specs.map((spec) => spec.attribute)).size).toBe(specs.length);
  });

  it("has a palette label for every theme", () => {
    for (const [name, spec] of Object.entries(UI_THEMES)) {
      expect(en[spec.labelKey], name).toBeTruthy();
    }
  });

  it("maps the next-themes selection to the editor/terminal appearance", () => {
    expect(appearanceOf("light", "light", "light")).toBe("light");
    expect(appearanceOf("dark", "dark", "light")).toBe("dark");
    expect(appearanceOf("system", "dark", "dark")).toBe("dark");
    expect(appearanceOf("system", "light", "light")).toBe("light");
  });

  it("maps a data-theme attribute back to its appearance", () => {
    expect(appearanceOfAttribute("facilis-dark")).toBe("dark");
    expect(appearanceOfAttribute("facilis-light")).toBe("light");
    expect(appearanceOfAttribute("nope")).toBe("light");
    expect(appearanceOfAttribute(null)).toBe("light");
  });
});
