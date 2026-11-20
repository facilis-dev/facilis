// The update recipes this build ships (APP-UPDATES.md §4).
//
// A recipe is code: ordered, idempotent and reviewed with the build that carries it, so
// an air-gapped deployment can upgrade a project without fetching anything. The engine
// that plans and applies them (upgrade/plan.ts, upgrade/apply.ts) is real and tested.
//
// The first shipped recipe is the framework-minimum step (D-198): it rewrites a project's
// below-minimum @facilis.dev/* exact pins up to the versions this build compiled in. Its
// trigger is the pin check, not the marker comparison — planUpdate's requiredTargets carries
// it — so its version range is an ordering key, not an environment jump: "to" is the highest
// built-in minimum, and the applier keeps the project's own environmentVersion in the marker.
//
// Adding another: append { from, to, titleKey, files } here, add the titleKey to
// ide/src/i18n/en-updates.ts (and it-updates.ts), and cover it with a test in upgrade/plan.test.ts.

import { frameworkPackageMinimums } from "@/deploy/current";
import { rewriteFrameworkPins } from "./package-minimums";
import { compareVersions } from "./updates";
import type { UpdateRecipe } from "./upgrade/recipe";

/** The highest built-in minimum, or null when the table holds nothing above 0.0.0. */
function highestMinimum(minimums: Record<string, string>): string | null {
  let highest: string | null = null;
  for (const version of Object.values(minimums)) {
    if (highest === null || (compareVersions(version, highest) ?? 0) > 0) highest = version;
  }
  if (highest === null || (compareVersions(highest, "0.0.0") ?? 0) <= 0) return null;
  return highest;
}

/**
 * The framework-minimum recipe's target, or null when this build compiled no usable
 * minimum table (an unbundled import). Null keeps the recipe out of the table: a recipe
 * that cannot move forward would fail assertRecipeTable for every plan.
 */
export const FRAMEWORK_MINIMUM_TARGET: string | null = highestMinimum(frameworkPackageMinimums);

const frameworkMinimumRecipe: UpdateRecipe | null =
  FRAMEWORK_MINIMUM_TARGET === null
    ? null
    : {
        from: "0.0.0",
        to: FRAMEWORK_MINIMUM_TARGET,
        titleKey: "updates.frameworkMinimum.title",
        files: async (read) => {
          const text = await read("package.json");
          if (text === null) return [];
          const next = rewriteFrameworkPins(text, frameworkPackageMinimums);
          // null = every pin already satisfies the minimums: the step is a no-op, which is
          // what makes running it twice safe.
          return next === null ? [] : [{ path: "package.json", content: next }];
        },
      };

export const UPDATE_RECIPES: readonly UpdateRecipe[] =
  frameworkMinimumRecipe === null ? [] : [frameworkMinimumRecipe];
