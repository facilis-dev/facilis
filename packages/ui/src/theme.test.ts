import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards D-047's two invariants at the source level, because a missing role in one theme
// block or a colour literal in a component is a silent visual bug, not a type error.
const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const srcDir = new URL("./", import.meta.url);

const SELECTORS = [":root", '[data-theme="light"]', '[data-theme="dark"]'] as const;

function escapeSelector(selector: string): string {
  return selector.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function variablesOf(selector: string): string[] {
  const block = new RegExp(escapeSelector(selector) + "\\s*\\{([^}]*)\\}").exec(theme);
  if (block?.[1] === undefined) return [];
  return [...block[1].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] as string).toSorted();
}

describe("theme.css", () => {
  it("defines the same complete role set in every theme block", () => {
    const [root, light, dark] = SELECTORS.map(variablesOf) as [string[], string[], string[]];
    expect(root.length).toBeGreaterThan(15);
    expect(light).toEqual(root);
    expect(dark).toEqual(root);
  });

  it("never lets a component hard-code a colour (only theme.css may)", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(srcDir)) {
      if (!/\.(tsx?|ts)$/.test(file) || file.includes(".test.")) continue;
      const source = readFileSync(new URL(file, srcDir), "utf8");
      if (/#[0-9a-fA-F]{3,8}\b|(?:oklch|rgba?|hsla?)\(/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
