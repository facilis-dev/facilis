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

/** "same-origin" is a keyword, anything else a URL without its trailing slash (D-079). */
function normalizeGitProxy(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (raw === "") return null;
  if (raw === "same-origin") return "same-origin";
  return withoutTrailingSlash(raw);
}

/** Only the public OAuth client id is configured (D-082); blank means off. */
function normalizeOAuthClientId(value: string | undefined): string | null {
  const id = value?.trim() ?? "";
  return id === "" ? null : id;
}

/** The CSP compares origins, so a configured URL is reduced to one. */
function originOfUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
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
      imports: { folder: true, git: true, share: true },
      exports: { git: true },
      // The hosted IDE serves the stateless proxy from its own origin (D-079); a bare
      // static deployment answers 404 and the client reports git as unavailable.
      gitProxy: "same-origin",
      gitOAuth: { githubClientId: null },
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
      ? { folder: false, git: false, share: false }
      : { folder: true, git: true, share: true },
    // Write-back is the one remote capability a managed build may opt into: it sends
    // the company's own code out, never brings code in (D-078).
    exports: { git: !managed },
    gitProxy: managed ? null : "same-origin",
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
    for (const key of ["folder", "git", "share"] as const) {
      if (raw.projects?.imports?.[key] === true) {
        issues.push("projects.imports." + key + ": must stay false in a managed build");
      }
    }
    if (raw.ai?.mode === "off" && (raw.ai.providers ?? []).length > 0) {
      issues.push("ai.providers: meaningless when ai.mode is 'off'");
    }
    // A push is a cross-origin API call: without a declared host the CSP would block it
    // at runtime, which reads as a broken feature rather than as a policy (D-078).
    if (raw.projects?.exports?.git === true && (raw.network?.connect ?? []).length === 0) {
      issues.push("network.connect: required when projects.exports.git is enabled");
    }
    // Real git (D-079) is one proxy hop: same-origin needs nothing from the CSP, an
    // outside proxy origin must be reachable. A proxy with no direction enabled would
    // ship dead code, so it is an error rather than a default.
    const gitProxy = normalizeGitProxy(raw.projects?.gitProxy);
    if (gitProxy !== null && gitProxy !== "same-origin") {
      const proxyOrigin = originOfUrl(gitProxy);
      const declared = (raw.network?.connect ?? []).map(originOfUrl);
      if (proxyOrigin === null || !declared.includes(proxyOrigin)) {
        issues.push(
          "network.connect: must include the projects.gitProxy origin (" +
            (proxyOrigin ?? "?") +
            ")",
        );
      }
    }
    if (
      gitProxy !== null &&
      raw.projects?.imports?.git !== true &&
      raw.projects?.exports?.git !== true
    ) {
      issues.push("projects.gitProxy: requires projects.imports.git or projects.exports.git");
    }
  }

  // GitHub sign-in (D-082) is a second way to reach the same git proxy, never a
  // replacement for it: the device flow calls github.com through that hop, so a
  // client id without a proxy (or with no direction enabled) is dead configuration.
  const gitOAuthClientId = normalizeOAuthClientId(raw.projects?.gitOAuth?.github?.clientId);
  const effectiveProxy = normalizeGitProxy(raw.projects?.gitProxy) ?? defaults.gitProxy;
  const effectiveImportsGit = raw.projects?.imports?.git ?? defaults.imports.git;
  const effectiveExportsGit = raw.projects?.exports?.git ?? defaults.exports.git;
  if (gitOAuthClientId !== null) {
    if (effectiveProxy === null) {
      issues.push("projects.gitOAuth: requires projects.gitProxy");
    }
    if (!effectiveImportsGit && !effectiveExportsGit) {
      issues.push("projects.gitOAuth: requires projects.imports.git or projects.exports.git");
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
        share: raw.projects?.imports?.share ?? defaults.imports.share,
      },
      exports: { git: raw.projects?.exports?.git ?? defaults.exports.git },
      gitProxy: normalizeGitProxy(raw.projects?.gitProxy) ?? defaults.gitProxy,
      gitOAuth: { githubClientId: gitOAuthClientId },
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
