// The first shipped recipe (D-198): the framework-minimum step. The compiled minimum
// table is real under Vitest (the deployment plugin's define rides the vite.config merge),
// so expectations derive from it instead of hardcoding a release number.

import { describe, expect, it } from "vitest";
import { frameworkPackageMinimums } from "@/deploy/current";
import { compareVersions } from "./updates";
import { FRAMEWORK_MINIMUM_TARGET, UPDATE_RECIPES } from "./update-recipes";
import { assertRecipeTable } from "./upgrade/plan";

const CORE_MINIMUM = frameworkPackageMinimums["@facilis.dev/core"];

describe("framework-minimum recipe (D-198)", () => {
  it("ships a forward-moving, unambiguous table", () => {
    expect(CORE_MINIMUM).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(UPDATE_RECIPES.length).toBe(1);
    expect(() => assertRecipeTable(UPDATE_RECIPES)).not.toThrow();
    // The ordering key is the highest built-in minimum.
    const highest = Object.values(frameworkPackageMinimums).sort(
      (a, b) => compareVersions(b, a) ?? 0,
    )[0];
    expect(FRAMEWORK_MINIMUM_TARGET).toBe(highest);
    expect(UPDATE_RECIPES[0].to).toBe(highest);
  });

  it("has a localized title key (D-070)", () => {
    expect(UPDATE_RECIPES[0].titleKey).toBe("updates.frameworkMinimum.title");
  });

  it("rewrites below-minimum pins up to the compiled minimums", async () => {
    const source = JSON.stringify({
      name: "facilis-app",
      dependencies: { "@facilis.dev/core": "0.0.0", react: "19.3.0" },
    });
    const files = await UPDATE_RECIPES[0].files(async (path) =>
      path === "package.json" ? source : null,
    );
    expect(files.length).toBe(1);
    expect(files[0].path).toBe("package.json");
    const next = JSON.parse(files[0].content as string) as {
      dependencies: Record<string, string>;
    };
    expect(next.dependencies["@facilis.dev/core"]).toBe(CORE_MINIMUM);
    expect(next.dependencies.react).toBe("19.3.0");
  });

  it("is idempotent: the rewritten body plans no further change", async () => {
    const source = JSON.stringify({ dependencies: { "@facilis.dev/core": "0.0.0" } });
    const files = await UPDATE_RECIPES[0].files(async () => source);
    const rewritten = files[0].content as string;
    expect(await UPDATE_RECIPES[0].files(async () => rewritten)).toEqual([]);
  });

  it("plans nothing for satisfying pins, dev-local specs or a missing package.json", async () => {
    const satisfying = JSON.stringify({ dependencies: { "@facilis.dev/core": CORE_MINIMUM } });
    expect(await UPDATE_RECIPES[0].files(async () => satisfying)).toEqual([]);
    const local = JSON.stringify({
      dependencies: { "@facilis.dev/core": "file:./vendor/facilis/core" },
    });
    expect(await UPDATE_RECIPES[0].files(async () => local)).toEqual([]);
    expect(await UPDATE_RECIPES[0].files(async () => null)).toEqual([]);
  });
});
