/**
 * Environment access is centralised so the dev-only guards have one definition.
 *
 * The default is **fail-closed** (D-146): only an explicit `development` or `test` counts as
 * non-production, so a deploy that forgets NODE_ENV still gets the production guards (404 dev
 * endpoints, Secure cookies, no in-memory PGlite) instead of exposing them.
 */
export function isProductionEnvironment(environment: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = environment["NODE_ENV"];
  return nodeEnv !== "development" && nodeEnv !== "test";
}

export function readEnvironment(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return environment[name];
}
