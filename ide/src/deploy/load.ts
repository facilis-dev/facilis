// Reading the deployment config: text first, then the environment.
//
// The Node side (ide/vite.deployment.ts) owns file I/O and the env var; this module stays
// pure so the fail-closed rules are testable without touching the filesystem.

import { resolveDeployment } from "./resolve.ts";
import { DeploymentError, validateDeployment } from "./validate.ts";
import type { DeploymentInput, ResolvedDeployment } from "./types.ts";

/** The build-time variable that selects a deployment config (MANAGED-DEPLOYMENT.md §3). */
export const DEPLOYMENT_CONFIG_ENV = "FACILIS_DEPLOY_CONFIG";

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DeploymentError(source, ["not valid JSON: " + detail]);
  }
}

/** Parse and validate one config document. Throws DeploymentError with every issue. */
export function parseDeploymentText(text: string, source: string): ResolvedDeployment {
  return resolveDeployment(validateDeployment(parseJson(text, source)), source);
}

export interface DeploymentEnvSource {
  /** The value of FACILIS_DEPLOY_CONFIG: undefined when the variable is not set. */
  value: string | undefined;
  /** Reads a file as UTF-8; injected so the caller owns the filesystem. */
  readFile: (filePath: string) => string;
}

/**
 * Resolve the build's deployment.
 *
 * Unset means the open profile, exactly today's build. Set means the file must exist,
 * parse, validate and state its profile - a typo in the variable must never fall back to
 * a permissive artifact, which is the whole reason this is fail-closed.
 */
export function deploymentFromEnv(env: DeploymentEnvSource): ResolvedDeployment {
  if (env.value === undefined) return resolveDeployment({}, "built-in open profile");
  if (env.value.trim() === "") {
    throw new DeploymentError(DEPLOYMENT_CONFIG_ENV, ["set but empty"]);
  }

  let text: string;
  try {
    text = env.readFile(env.value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DeploymentError(env.value, ["cannot read: " + detail]);
  }

  const input = parseJson(text, env.value) as DeploymentInput;
  if (!isObject(input) || input.profile === undefined) {
    throw new DeploymentError(env.value, [
      "profile: required when " + DEPLOYMENT_CONFIG_ENV + " is set",
    ]);
  }
  return resolveDeployment(validateDeployment(input), env.value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
