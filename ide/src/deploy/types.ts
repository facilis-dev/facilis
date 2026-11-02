// The deployment profile: what a build is allowed to do, compiled in (D-063/D-064).
//
// This module is pure data: no Node imports, no browser globals. The build-time loader
// (ide/vite.deployment.ts) reads it from FACILIS_DEPLOY_CONFIG; the app reads the
// resolved copy through ide/src/deploy/current.ts.

export type DeploymentProfile = "open" | "managed";

/** How the IDE may reach an LLM. "off" keeps the key out of the browser entirely. */
export type AiMode = "off" | "byo" | "gateway";

/** Whether the VM offers a free shell or only the project's Run. */
export type ShellMode = "shell" | "run-only";

export type InstallScriptsPolicy = "deny" | "allow";
export type LockfilePolicy = "required" | "optional";
export type AdmissionPolicy = "facilis-only" | "any";
export type UpdateChannel = "approved" | "latest";

/** The three ways a project can enter the IDE. `false` means the path is compiled out. */
export interface ProjectImports {
  folder?: boolean;
  git?: boolean;
  share?: boolean;
}

/** The ways a project can leave the IDE. `false` means the path is compiled out (D-078). */
export interface ProjectExports {
  /** Write-back to GitHub/GitLab/Gitea: commit the working tree to a branch. */
  git?: boolean;
}

/** Where real git-over-HTTPS reaches the hosts (D-079): the same origin, or a URL. */
export type GitProxy = "same-origin" | string;

/**
 * The OAuth app that signs a user in without a pasted token (D-082). Only the public
 * client id is configured; the device flow needs no client secret, so no secret is
 * ever shipped.
 */
export interface GitOAuth {
  github?: { clientId?: string };
}

export interface DeploymentCompany {
  name?: string;
  domain?: string;
}

export interface DeploymentPackages {
  /** The one registry a managed build may reach; a mirror, never the public one. */
  registry?: string;
  /** Direct-dependency allowlist, checked by the IDE and enforced by the mirror. */
  allow?: string[];
  /** npm 12 denies install scripts by default; the config makes the decision explicit. */
  installScripts?: InstallScriptsPolicy;
  lockfile?: LockfilePolicy;
}

export interface DeploymentProjects {
  admission?: AdmissionPolicy;
  imports?: ProjectImports;
  exports?: ProjectExports;
  /** Stateless git proxy base (D-079); null means real git is compiled out. */
  gitProxy?: GitProxy;
  /** The GitHub OAuth app for the device flow (D-082); absent means paste a token. */
  gitOAuth?: GitOAuth;
  preview?: { origin?: string };
  shell?: ShellMode;
}

export interface DeploymentAi {
  mode?: AiMode;
  /** Preset ids (see ide/src/ai/providers.ts) the deployment lets the IDE call. */
  providers?: string[];
  /** The internal LLM endpoint used instead of a provider, when mode is "gateway". */
  gateway?: string | null;
}

export interface DeploymentSkills {
  /** Skill ids the deployment allows; empty means none in a managed build. */
  allow?: string[];
}

export interface DeploymentNetwork {
  /** Extra hosts the CSP may connect to (recorded; the build derives the rest). */
  connect?: string[];
}

export interface DeploymentUpdates {
  channel?: UpdateChannel;
  /** The environment version the update checker treats as approved (APP-UPDATES.md). */
  baseline?: string;
}

/** The shape of the JSON file FACILIS_DEPLOY_CONFIG points at. */
export interface DeploymentInput {
  schemaVersion?: number;
  profile?: DeploymentProfile;
  company?: DeploymentCompany;
  packages?: DeploymentPackages;
  projects?: DeploymentProjects;
  ai?: DeploymentAi;
  skills?: DeploymentSkills;
  network?: DeploymentNetwork;
  updates?: DeploymentUpdates;
}

/**
 * The fully-defaulted, JSON-serializable profile the build compiles in and the app reads.
 * `null` means "not applicable to this profile", never "empty string".
 */
export interface ResolvedDeployment {
  schemaVersion: 1;
  profile: DeploymentProfile;
  company: { name: string; domain: string };
  packages: {
    registry: string | null;
    allow: string[];
    installScripts: InstallScriptsPolicy;
    lockfile: LockfilePolicy;
  };
  projects: {
    admission: AdmissionPolicy;
    imports: { folder: boolean; git: boolean; share: boolean };
    exports: { git: boolean };
    gitProxy: string | null;
    gitOAuth: { githubClientId: string | null };
    preview: { origin: string | null };
    shell: ShellMode;
  };
  ai: { mode: AiMode; providers: string[]; gateway: string | null };
  skills: { allow: string[] };
  network: { connect: string[] };
  updates: { channel: UpdateChannel; baseline: string };
}
