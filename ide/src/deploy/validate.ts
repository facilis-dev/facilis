// Validation for the deployment config (D-064). No schema library: the IDE already
// ships without one, and a hand-written check keeps the build dependency-free.
//
// The posture is fail-closed: unknown keys are errors (a typo in "allow" must not
// silently leave the allowlist empty) and every field is checked before use.

import {
  checkKeys,
  fieldBoolean,
  fieldEnum,
  fieldObject,
  fieldString,
  fieldStringArray,
  fieldUrl,
  isObject,
  parseUrl,
} from "./fields.ts";
import { checkTelemetry } from "./telemetry.ts";
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

const TOP_KEYS = [
  "schemaVersion",
  "profile",
  "company",
  "packages",
  "projects",
  "ai",
  "skills",
  "network",
  "telemetry",
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
      ["admission", "imports", "exports", "gitProxy", "gitOAuth", "preview", "shell"],
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
    const gitOAuth = fieldObject(projects, "gitOAuth", "deployment.projects", issues);
    if (gitOAuth) {
      checkKeys(gitOAuth, ["github"], "deployment.projects.gitOAuth", issues);
      const github = fieldObject(gitOAuth, "github", "deployment.projects.gitOAuth", issues);
      if (github) {
        checkKeys(github, ["clientId"], "deployment.projects.gitOAuth.github", issues);
        const clientId = fieldString(
          github,
          "clientId",
          "deployment.projects.gitOAuth.github",
          issues,
        );
        if (
          clientId !== undefined &&
          (clientId.trim() === "" || /\s/.test(clientId) || clientId.length > 128)
        ) {
          issues.push(
            "deployment.projects.gitOAuth.github.clientId: expected a non-empty client id without spaces",
          );
        }
      } else if (gitOAuth.github === undefined) {
        issues.push("deployment.projects.gitOAuth.github: required");
      }
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

  const telemetry = fieldObject(raw, "telemetry", "deployment", issues);
  if (telemetry) checkTelemetry(telemetry, issues);

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
