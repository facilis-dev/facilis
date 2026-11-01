// The files a managed build emits next to the SPA (D-064):
// headers.conf, environment.json, mirror-allowlist.json, npmrc.template.
//
// Pure functions over the resolved profile: the Vite plugin owns the writes, so every
// format here is testable without building the app.

import type { ResolvedDeployment } from "./types.ts";

/** A CSP source list is order-sensitive only for readability; duplicates are removed. */
function sources(...groups: (string | null | undefined)[]): string {
  const seen: string[] = [];
  for (const group of groups) {
    if (group === null || group === undefined || group === "") continue;
    if (!seen.includes(group)) seen.push(group);
  }
  return seen.join(" ");
}

/** The origin of a URL, for CSP source lists (a path is not a valid source). */
function originOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export interface ProviderHosts {
  /** Preset id -> base URL, from ide/src/ai/providers.ts. */
  readonly [presetId: string]: string;
}

export interface ArtifactInput {
  deployment: ResolvedDeployment;
  providerHosts: ProviderHosts;
  /** FACILIS_ENV_VERSION, or the package version; recorded, never interpreted here. */
  version: string;
  /** SHA-256 of the config bytes, so the artifact names its own policy. */
  configHash: string;
  /** Emitted files -> SHA-256; empty until closeBundle has read the output. */
  artifacts?: Readonly<Record<string, string>>;
  /** Base64 SHA-256 of each inline script in the built index.html (theme pre-paint). */
  inlineScripts?: readonly string[];
}

/** The provider origins a managed "byo" build may reach. */
function aiSources(input: ArtifactInput): string[] {
  const { deployment } = input;
  if (deployment.profile !== "managed" || deployment.ai.mode === "off") return [];
  if (deployment.ai.mode === "gateway") {
    const gateway = originOf(deployment.ai.gateway);
    return gateway === null ? [] : [gateway];
  }
  return deployment.ai.providers
    .map((id) => originOf(input.providerHosts[id] ?? null))
    .filter((value): value is string => value !== null);
}

/**
 * Connect-src: the IDE origin, the mirror, the preview origin, the AI exception and any
 * extra host the deployment declared. Nothing else is reachable from the managed build.
 */
export function connectSources(input: ArtifactInput): string[] {
  const { deployment } = input;
  const registry = originOf(deployment.packages.registry);
  const preview = originOf(deployment.projects.preview.origin);
  return [
    "'self'",
    registry,
    preview,
    ...aiSources(input),
    ...deployment.network.connect.map((url) => originOf(url)),
  ].filter((value): value is string => value !== null);
}

/**
 * script-src, shared by both profiles. The kernel evaluates the project's code with
 * new Function (the requirement is documented in vendor/vivari/packages/runtime/module.js),
 * so 'unsafe-eval' is not optional: without it the shell boots, a project is created and
 * the VM never runs, so the preview never paints (measured 2026-11-01, MANAGED-DEPLOYMENT
 * §12). 'wasm-unsafe-eval' is only about compiling wasm. The inline hashes cover the
 * pre-paint theme script, which has no external file (D-072).
 */
function scriptSources(input: ArtifactInput): string {
  const hashes = (input.inlineScripts ?? []).map((hash) => "'sha256-" + hash + "'");
  return ["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'", ...hashes].join(" ");
}

export function csp(input: ArtifactInput): string {
  const connect = sources(...connectSources(input));
  const preview = originOf(input.deployment.projects.preview.origin);
  return [
    "default-src 'self';",
    "script-src " + scriptSources(input) + ";",
    "worker-src 'self' blob:;",
    // Monaco and Tailwind inject styles at runtime.
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data: blob:;",
    "font-src 'self';",
    "connect-src " + (connect === "" ? "'self'" : connect) + ";",
    "frame-src " + sources("'self'", preview) + ";",
    "base-uri 'none';",
    "object-src 'none';",
  ].join("\n");
}

/**
 * The baseline policy for the default (open) profile (D-072). Same code rules as managed:
 * no remote scripts, no plugins, no framing of other origins. The network is left open on
 * purpose - that profile is documented as unrestricted - so the win is narrower: a project
 * cannot pull a script off the internet, it can only run code it already carries.
 */
export function openCsp(input: ArtifactInput): string {
  return [
    "default-src 'self';",
    "script-src " + scriptSources(input) + ";",
    "worker-src 'self' blob:;",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data: blob:;",
    "font-src 'self' data:;",
    "media-src 'self' blob:;",
    // Open by design: any https/wss host, the loopback relay and the blob/data the VM
    // fetches while installing dependencies.
    "connect-src 'self' https: wss: ws: blob: data:;",
    "frame-src 'self';",
    "base-uri 'none';",
    "object-src 'none';",
  ].join("\n");
}

/**
 * The header file the host has to serve. COOP/COEP are mandatory for the WebContainer
 * (SharedArrayBuffer). Both profiles carry a CSP: managed encodes the deployment's policy,
 * open carries the baseline that still blocks remote code and plugins (D-071, D-072).
 */
export function renderHeaders(input: ArtifactInput): string {
  const lines = [
    "# Generated by the Facilis deployment build. Serve these exact headers (D-064).",
    "Cross-Origin-Opener-Policy: same-origin",
    "Cross-Origin-Embedder-Policy: require-corp",
    "Service-Worker-Allowed: /",
  ];
  const policy = input.deployment.profile === "managed" ? csp(input) : openCsp(input);
  // One line: a header value cannot carry the paragraph breaks the builders use.
  lines.push("Content-Security-Policy: " + policy.split("\n").join(" "));
  lines.push("X-Content-Type-Options: nosniff");
  return lines.join("\n") + "\n";
}

/** The mirror's allowlist, generated from the same packages.allow the bundle enforces. */
export function renderMirrorAllowlist(deployment: ResolvedDeployment): string {
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        registry: deployment.packages.registry,
        packages: deployment.packages.allow,
        installScripts: deployment.packages.installScripts,
        lockfile: deployment.packages.lockfile,
      },
      null,
      2,
    ) + "\n"
  );
}

/** What the operator and the update checker read at deploy time. */
export function renderEnvironment(input: ArtifactInput): string {
  const { deployment } = input;
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        version: input.version,
        profile: deployment.profile,
        company: deployment.company,
        registry: deployment.packages.registry,
        previewOrigin: deployment.projects.preview.origin,
        aiMode: deployment.ai.mode,
        skills: deployment.skills.allow,
        configHash: input.configHash,
        artifacts: input.artifacts ?? {},
      },
      null,
      2,
    ) + "\n"
  );
}

/** The generated project's .npmrc: the mirror is the only registry it may reach. */
export function renderProjectNpmrc(deployment: ResolvedDeployment): string {
  const lines = [
    "; Generated by the Facilis deployment build. Do not edit.",
    "audit=false",
    "fund=false",
    "progress=false",
    "update-notifier=false",
  ];
  if (deployment.packages.registry !== null) {
    lines.push("registry=" + deployment.packages.registry);
  }
  return lines.join("\n") + "\n";
}

const PUBLIC_REGISTRY = "https://registry.npmjs.org";

/**
 * The build adds a dns-prefetch hint for the public registry. A managed build must not
 * point the browser at it: rewrite the hint to the configured mirror, or drop it.
 */
export function rewriteRegistryHint(html: string, deployment: ResolvedDeployment): string {
  if (deployment.profile !== "managed") return html;
  const registry = deployment.packages.registry;
  if (registry === null) return html;
  return html.split(PUBLIC_REGISTRY).join(registry);
}
