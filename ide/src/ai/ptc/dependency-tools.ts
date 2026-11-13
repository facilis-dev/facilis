// list_dependencies for the PTC runtime.
//
// The model may read any installed package by path (policy.ts allows node_modules), but it
// cannot guess which packages a project installed nor where a package's API lives. This family
// gives it that map: the package list, then one package's files. Thin by design — this module
// validates arguments only; caps and name refusals live in dependency-access.ts, which the
// router host injects (absent seam -> no tool, like the other runtime families).

import type { DependencyAccess } from "../dependency-access";
import type { RuntimeToolHandler } from "./graph-tools";
import { PtcToolError, type PtcJson } from "./protocol";

/** The router host slice: the family is advertised exactly when the seam exists. */
export interface DependencyToolHost {
  readonly dependencies?: DependencyAccess;
}

/** npm's package-name limit; a longer argument is malformed, not merely unsafe. */
const MAX_PACKAGE_ARG_CHARS = 214;

type Args = Record<string, unknown>;

function refuse(message: string): never {
  throw new PtcToolError("capability", message);
}

function argsOf(value: unknown): Args {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse("arguments must be one JSON object, e.g. tools.list_dependencies({ package: 'react' })");
  }
  return value as Args;
}

function packageOf(args: Args): string | undefined {
  const value = args["package"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PACKAGE_ARG_CHARS) {
    refuse(
      "package must be a non-empty string of at most " + MAX_PACKAGE_ARG_CHARS + " characters",
    );
  }
  return value;
}

/** The seam returns plain JSON; the round trip keeps the sandbox boundary honest. */
function json(value: unknown): PtcJson {
  return JSON.parse(JSON.stringify(value)) as PtcJson;
}

export function createDependencyToolHandlers(
  host: DependencyToolHost,
): Readonly<Record<string, RuntimeToolHandler>> {
  const dependencies = host.dependencies;
  if (dependencies === undefined) return {};
  return {
    async list_dependencies(rawArgs) {
      const args = argsOf(rawArgs);
      const packageName = packageOf(args);
      const result = await dependencies.list(
        packageName === undefined ? {} : { package: packageName },
      );
      if (result.kind === "refused") {
        // The model reads this: name the accepted shape so the wrong call is self-correcting.
        refuse(
          "not an installed-package name (expected e.g. react or @scope/name): " +
            JSON.stringify(result.package),
        );
      }
      return json(result);
    },
  };
}
