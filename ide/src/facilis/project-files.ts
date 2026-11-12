// The full-stack template's IDE-owned files, with the deployment's npm policy (D-062).
//
// Kept as the stable entry point existing callers and tests use: a template assembled
// through template-files.ts passes its own wrappers, this composes the full-stack ones.
//
// `d` is the deployment profile because the npm wrapper carries the deployment's package
// policy: the IDE runs the same sources for every profile, so the generated `.npmrc` (not
// the IDE build) is where a managed project learns which registry it may reach. Defaults
// to the compiled profile; tests pass a fixture.

import { deployment, environmentVersion } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import { examplePackageJson } from "./example-template";
import {
  FULLSTACK_README,
  FULLSTACK_TSCONFIG_INCLUDE,
  fullstackPackageJson,
} from "./fullstack-files";
import { projectFileTemplates } from "./template-files";

/** The generated full-stack project, from examples/todo-app plus what only the IDE can write. */
export function projectFiles(
  d: ResolvedDeployment = deployment,
  version: string = environmentVersion,
): Record<string, string> {
  return projectFileTemplates(d, version, {
    packageJson: fullstackPackageJson(examplePackageJson()),
    readme: FULLSTACK_README,
    tsconfigInclude: FULLSTACK_TSCONFIG_INCLUDE,
  });
}
