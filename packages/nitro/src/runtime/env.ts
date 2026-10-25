/**
 * Environment access is centralised so the dev-only guards have one definition.
 *
 * SPEC §6.1/§8.5 define dev endpoints as available when NODE_ENV is not
 * "production"; an unset NODE_ENV therefore counts as development, matching
 * `vite dev`.
 */
export function isProductionEnvironment(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment["NODE_ENV"] === "production";
}

export function readEnvironment(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return environment[name];
}
