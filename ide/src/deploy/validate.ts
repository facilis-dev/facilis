// Validation for the deployment config (D-064). No schema library: the IDE already
// ships without one, and a hand-written check keeps the build dependency-free.
//
// The posture is fail-closed: unknown keys are errors (a typo in "allow" must not
// silently leave the allowlist empty) and every field is checked before use.

import type { DeploymentInput } from "./types.ts";

/** Raised for both validation and invariant failures; the message lists every issue. */
export class DeploymentError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(source + ": " + issues.join("; "));
    this.name = "DeploymentError";
    this.issues = issues;
  }
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(obj: Obj, allowed: readonly string[], at: string, issues: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(at + "." + key + ": unknown key");
  }
}

function fieldObject(obj: Obj, key: string, at: string, issues: string[]): Obj | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    issues.push(at + "." + key + ": expected an object");
    return undefined;
  }
  return value;
}

function fieldString(obj: Obj, key: string, at: string, issues: string[]): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.push(at + "." + key + ": expected a string");
    return undefined;
  }
  return value;
}

function fieldBoolean(obj: Obj, key: string, at: string, issues: string[]): boolean | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push(at + "." + key + ": expected a boolean");
    return undefined;
  }
  return value;
}

function fieldEnum<T extends string>(
  obj: Obj,
  key: string,
  at: string,
  allowed: readonly T[],
  issues: string[],
): T | undefined {
  const value = fieldString(obj, key, at, issues);
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    issues.push(at + "." + key + ": expected one of " + allowed.join(", "));
    return undefined;
  }
  return value as T;
}

function fieldStringArray(
  obj: Obj,
  key: string,
  at: string,
  issues: string[],
): string[] | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    issues.push(at + "." + key + ": expected an array of non-empty strings");
    return undefined;
  }
  return value as string[];
}

/** An absolute http(s) URL is the only shape a registry, an origin or a gateway may take. */
function fieldUrl(obj: Obj, key: string, at: string, issues: string[]): string | undefined {
  const value = fieldString(obj, key, at, issues);
  if (value === undefined) return undefined;
  const url = parseUrl(value);
  if (url === null) issues.push(at + "." + key + ": expected an absolute http(s) URL");
  return url === null ? undefined : value;
}

export function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

const TOP_KEYS = [
  "schemaVersion",
  "profile",
  "company",
  "packages",
  "projects",
  "ai",
  "skills",
  "network",
  "updates",
] as const;

export function validateDeployment(raw: unknown): DeploymentInput {
  const issues: string[] = [];
  if (!isObject(raw)) throw new DeploymentError("deployment config", ["expected a JSON object"]);

  checkKeys(raw, TOP_KEYS, "deployment", issues);

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    issues.push("deployment.schemaVersion: only 1 is supported");
  }

  fieldEnum(raw, "profile", "deployment", ["open", "managed"], issues);

  const company = fieldObject(raw, "company", "deployment", issues);
  if (company) {
    checkKeys(company, ["name", "domain"], "deployment.company", issues);
    fieldString(company, "name", "deployment.company", issues);
    fieldString(company, "domain", "deployment.company", issues);
  }

  const packages = fieldObject(raw, "packages", "deployment", issues);
  if (packages) {
    checkKeys(
      packages,
      ["registry", "allow", "installScripts", "lockfile"],
      "deployment.packages",
      issues,
    );
    fieldUrl(packages, "registry", "deployment.packages", issues);
    fieldStringArray(packages, "allow", "deployment.packages", issues);
    fieldEnum(packages, "installScripts", "deployment.packages", ["deny", "allow"], issues);
    fieldEnum(packages, "lockfile", "deployment.packages", ["required", "optional"], issues);
  }

  const projects = fieldObject(raw, "projects", "deployment", issues);
  if (projects) {
    checkKeys(
      projects,
      ["admission", "imports", "exports", "gitProxy", "preview", "shell"],
      "deployment.projects",
      issues,
    );
    fieldEnum(projects, "admission", "deployment.projects", ["facilis-only", "any"], issues);
    fieldEnum(projects, "shell", "deployment.projects", ["shell", "run-only"], issues);
    const imports = fieldObject(projects, "imports", "deployment.projects", issues);
    if (imports) {
      checkKeys(imports, ["folder", "git", "share"], "deployment.projects.imports", issues);
      for (const key of ["folder", "git", "share"] as const) {
        fieldBoolean(imports, key, "deployment.projects.imports", issues);
      }
    }
    const exports = fieldObject(projects, "exports", "deployment.projects", issues);
    if (exports) {
      checkKeys(exports, ["git"], "deployment.projects.exports", issues);
      fieldBoolean(exports, "git", "deployment.projects.exports", issues);
    }
    const gitProxy = fieldString(projects, "gitProxy", "deployment.projects", issues);
    if (gitProxy !== undefined && gitProxy !== "same-origin" && parseUrl(gitProxy) === null) {
      issues.push(
        "deployment.projects.gitProxy: expected 'same-origin' or an absolute http(s) URL",
      );
    }
    const preview = fieldObject(projects, "preview", "deployment.projects", issues);
    if (preview) {
      checkKeys(preview, ["origin"], "deployment.projects.preview", issues);
      fieldUrl(preview, "origin", "deployment.projects.preview", issues);
    }
  }

  const ai = fieldObject(raw, "ai", "deployment", issues);
  if (ai) {
    checkKeys(ai, ["mode", "providers", "gateway"], "deployment.ai", issues);
    fieldEnum(ai, "mode", "deployment.ai", ["off", "byo", "gateway"], issues);
    fieldStringArray(ai, "providers", "deployment.ai", issues);
    const gateway = ai.gateway;
    if (gateway !== undefined && gateway !== null) {
      fieldUrl(ai, "gateway", "deployment.ai", issues);
    }
  }

  const skills = fieldObject(raw, "skills", "deployment", issues);
  if (skills) {
    checkKeys(skills, ["allow"], "deployment.skills", issues);
    fieldStringArray(skills, "allow", "deployment.skills", issues);
  }

  const network = fieldObject(raw, "network", "deployment", issues);
  if (network) {
    checkKeys(network, ["connect"], "deployment.network", issues);
    fieldStringArray(network, "connect", "deployment.network", issues);
  }

  const updates = fieldObject(raw, "updates", "deployment", issues);
  if (updates) {
    checkKeys(updates, ["channel", "baseline"], "deployment.updates", issues);
    fieldEnum(updates, "channel", "deployment.updates", ["approved", "latest"], issues);
    fieldString(updates, "baseline", "deployment.updates", issues);
  }

  if (issues.length > 0) throw new DeploymentError("deployment config", issues);
  // Every key and type above has been checked; the cast records that.
  return raw as DeploymentInput;
}
