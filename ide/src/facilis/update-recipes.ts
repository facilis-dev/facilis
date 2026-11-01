// The update recipes this build ships (APP-UPDATES.md §4).
//
// A recipe is code: ordered, idempotent and reviewed with the build that carries it, so
// an air-gapped deployment can upgrade a project without fetching anything. The engine
// that plans and applies them (upgrade/plan.ts, upgrade/apply.ts) is real and tested, but
// no version has shipped a recipe yet. An outdated project therefore reports "no recipe
// in this build" instead of offering an action the build cannot perform.
//
// Adding one: append { from, to, titleKey, files } here, add the titleKey to
// ide/src/i18n/en.ts (and it.ts), and cover it with a test in upgrade/plan.test.ts.

import type { UpdateRecipe } from "./upgrade/recipe";

export const UPDATE_RECIPES: readonly UpdateRecipe[] = [];
