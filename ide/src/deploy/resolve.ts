// From the validated config to the resolved profile: defaults per profile, invariants,
// and a deep freeze so no runtime code can change the policy it was built with (D-063).

import { DeploymentError } from "./validate.ts";
import type {
  AdmissionPolicy,
  AiMode,
  DeploymentInput,
  DeploymentProfile,
  InstallScriptsPolicy,
  LockfilePolicy,
  ResolvedDeployment,
  ShellMode,
  UpdateChannel,
} from "./types.ts";

function withoutTrailingSlash(url: string | undefined): string | null {
  if (url === undefined || url.trim() === "") return null;
  return url.trim().replace(/\/+$/, "");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** The profile of a build that was not configured: today's unrestricted IDE. */
export function openDeployment(): ResolvedDeployment {
  return deepFreeze({
    schemaVersion: 1,
    profile: "open",
    company: { name: "", domain: "" },
    packages: { registry: null, allow: [], installScripts: "deny", lockfile: "optional" },
    projects: {
      admission: "any",
      imports: { folder: true, git: true, npm: true, share: true },
      preview: { origin: null },
      shell: "shell",
    },
    ai: { mode: "byo", providers: [], gateway: null },
    skills: { allow: [] },
    network: { connect: [] },
    updates: { channel: "latest", baseline: "" },
  });
}

/** Defaults applied when a managed build left a field out. */
function defaultsFor(profile: DeploymentProfile) {
  const managed = profile === "managed";
  return {
    admission: (managed ? "facilis-only" : "any") as AdmissionPolicy,
    imports: managed
      ? { folder: false, git: false, npm: false, share: false }
      : { folder: true, git: true, npm: true, share: true },
    shell: "shell" as ShellMode,
    installScripts: "deny" as InstallScriptsPolicy,
    lockfile: (managed ? "required" : "optional") as LockfilePolicy,
    aiMode: (managed ? "off" : "byo") as AiMode,
    updateChannel: (managed ? "approved" : "latest") as UpdateChannel,
  };
}

/**
 * Resolve and check one deployment. Managed builds are fail-closed: a missing registry,
 * a missing isolated preview origin, or an AI mode that names nothing is an error, not
 * a default (MANAGED-DEPLOYMENT.md §2-§3).
 */
export function resolveDeployment(
  raw: DeploymentInput,
  source = "deployment config",
): ResolvedDeployment {
  const profile = raw.profile ?? "open";
  const defaults = defaultsFor(profile);
  const issues: string[] = [];

  const registry = withoutTrailingSlash(raw.packages?.registry);
  const previewOrigin = withoutTrailingSlash(raw.projects?.preview?.origin);
  const gateway = withoutTrailingSlash(raw.ai?.gateway ?? undefined);

  if (profile === "managed") {
    if (registry === null) issues.push("packages.registry: required in a managed build");
    if (previewOrigin === null) issues.push("projects.preview.origin: required in a managed build");
    const domain = raw.company?.domain?.trim() ?? "";
    const deploymentOrigin = domain === "" ? null : "https://" + domain;
    if (previewOrigin !== null && previewOrigin === deploymentOrigin) {
      issues.push("projects.preview.origin: must differ from the deployment origin");
    }
    if (raw.ai?.mode === "byo" && (raw.ai.providers ?? []).length === 0) {
      issues.push("ai.providers: required when ai.mode is 'byo'");
    }
    if (raw.ai?.mode === "gateway" && gateway === null) {
      issues.push("ai.gateway: required when ai.mode is 'gateway'");
    }
    for (const provider of raw.ai?.providers ?? []) {
      if (provider === "custom")
        issues.push("ai.providers: 'custom' has no fixed host and is not allowed");
    }
    for (const key of ["folder", "git", "npm", "share"] as const) {
      if (raw.projects?.imports?.[key] === true) {
        issues.push("projects.imports." + key + ": must stay false in a managed build");
      }
    }
    if (raw.ai?.mode === "off" && (raw.ai.providers ?? []).length > 0) {
      issues.push("ai.providers: meaningless when ai.mode is 'off'");
    }
  }

  if (issues.length > 0) throw new DeploymentError(source, issues);

  const resolved: ResolvedDeployment = {
    schemaVersion: 1,
    profile,
    company: {
      name: raw.company?.name?.trim() ?? "",
      domain: raw.company?.domain?.trim() ?? "",
    },
    packages: {
      registry,
      allow: [...(raw.packages?.allow ?? [])],
      installScripts: raw.packages?.installScripts ?? defaults.installScripts,
      lockfile: raw.packages?.lockfile ?? defaults.lockfile,
    },
    projects: {
      admission: raw.projects?.admission ?? defaults.admission,
      imports: {
        folder: raw.projects?.imports?.folder ?? defaults.imports.folder,
        git: raw.projects?.imports?.git ?? defaults.imports.git,
        npm: raw.projects?.imports?.npm ?? defaults.imports.npm,
        share: raw.projects?.imports?.share ?? defaults.imports.share,
      },
      preview: { origin: previewOrigin },
      shell: raw.projects?.shell ?? defaults.shell,
    },
    ai: {
      mode: raw.ai?.mode ?? defaults.aiMode,
      providers: [...(raw.ai?.providers ?? [])],
      gateway,
    },
    skills: { allow: [...(raw.skills?.allow ?? [])] },
    network: { connect: [...(raw.network?.connect ?? [])] },
    updates: {
      channel: raw.updates?.channel ?? defaults.updateChannel,
      baseline: raw.updates?.baseline?.trim() ?? "",
    },
  };

  return deepFreeze(resolved);
}
