// Build-time deployment loading and artifact emission (D-063/D-064).
//
// Lives outside src/ because it is Node code (fs, crypto, process): the app bundle must
// never import it. vite.config.ts registers deploymentPlugin(); the app reads the
// compiled profile through src/deploy/current.ts.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Plugin, ResolvedConfig } from "vite";
import {
  renderEnvironment,
  renderHeaders,
  renderMirrorAllowlist,
  renderProjectNpmrc,
  rewriteRegistryHint,
  type ArtifactInput,
} from "./src/deploy/artifacts.ts";
import { DEPLOYMENT_CONFIG_ENV, deploymentFromEnv } from "./src/deploy/load.ts";
import { PROVIDER_BASE_URLS } from "./src/deploy/provider-hosts.ts";
import type { ResolvedDeployment } from "./src/deploy/types.ts";

const ENV_VERSION = "FACILIS_ENV_VERSION";

/** The virtual modules a managed build substitutes for the import implementation (D-063). */
const GIT_IMPORT_OFF = "\0facilis:git-import-off";
const GIT_IMPORT_STUB = [
  "// Compiled out: this deployment allows no repository import (D-063).",
  'export function fetchGitRepo() { return Promise.reject(new Error("git import disabled")); }',
].join("\n");

const GIT_PROVIDER_OFF = "\0facilis:git-provider-off";
const GIT_PROVIDER_STUB = [
  "// Compiled out with the import: no host table, no URL parsing (D-063).",
  "export const GIT_PROVIDERS = [];",
  "export function detectGitProvider() { return null; }",
  "export function hostOfGitInput() { return null; }",
  "export function normalizeGitToken() { return null; }",
  "export function parseGitRepo() { return null; }",
].join("\n");

export interface LoadedDeployment {
  deployment: ResolvedDeployment;
  /** SHA-256 of the config bytes: the artifact names the policy that produced it. */
  configHash: string;
  source: string;
}

/**
 * Read the deployment synchronously, at config time. Fail-closed: a missing or invalid
 * file throws here, which fails the build instead of producing a permissive artifact.
 */
export function loadDeployment(): LoadedDeployment {
  const value = process.env[DEPLOYMENT_CONFIG_ENV];
  const deployment = deploymentFromEnv({
    value,
    readFile: (filePath) => fs.readFileSync(filePath, "utf8"),
  });
  const configHash = createHash("sha256")
    .update(value === undefined ? "open" : fs.readFileSync(value))
    .digest("hex");
  return { deployment, configHash, source: value ?? "built-in open profile" };
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * CSP hashes for the inline scripts the built page carries. The pre-paint theme script has
 * no external file to load, and without its hash the policy would drop it silently (a theme
 * flash that looks like a rendering bug). A future inline script is covered for free.
 */
function inlineScriptHashes(indexHtml: string): string[] {
  const hashes: string[] = [];
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  for (const match of indexHtml.matchAll(pattern)) {
    if (match[1].trim() === "") continue;
    hashes.push(createHash("sha256").update(match[1]).digest("base64"));
  }
  return hashes;
}

/** Relative paths, sorted, '/'-separated: the environment manifest must be stable. */
function listFiles(dir: string, base = dir, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, found);
    else if (entry.isFile()) found.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return found.sort();
}

/** The L0 removal of the git-import implementation when the policy allows none. */
function gitImportStub(deployment: ResolvedDeployment): Plugin {
  const off = deployment.profile === "managed" && !deployment.projects.imports.git;
  return {
    name: "facilis-git-import-off",
    // Pre: vite:resolve resolves "./git-import" before a normal plugin's hook sees
    // it, and the resolved id is what Rollup would then load. Winning the ordering is
    // what makes this a build-time removal rather than a runtime guard.
    enforce: "pre",
    resolveId(id) {
      if (!off) return null;
      if (id === "./git-import" || /[\\/]src[\\/]vv[\\/]git-import\.ts$/.test(id)) {
        return GIT_IMPORT_OFF;
      }
      // The host table and parser carry the only URLs the importer would call.
      if (
        id === "./git-provider" ||
        id === "@/vv/git-provider" ||
        /[\\/]src[\\/]vv[\\/]git-provider\.ts$/.test(id)
      ) {
        return GIT_PROVIDER_OFF;
      }
      return null;
    },
    load(id) {
      if (id === GIT_IMPORT_OFF) return GIT_IMPORT_STUB;
      if (id === GIT_PROVIDER_OFF) return GIT_PROVIDER_STUB;
      return null;
    },
  };
}

/**
 * Compile the profile into the bundle and, on a build, write the artifacts an operator
 * deploys: headers.conf, mirror-allowlist.json, npmrc.template and environment.json.
 */
export function deploymentPlugin(): Plugin[] {
  const loaded = loadDeployment();
  const version = process.env[ENV_VERSION] ?? "0.0.0";
  let resolved: ResolvedConfig | null = null;

  return [
    gitImportStub(loaded.deployment),
    {
      name: "facilis-deployment",
      config() {
        // A literal in the bundle: there is no file to fetch and nothing to override.
        const define: Record<string, string> = {
          __FACILIS_DEPLOYMENT__: JSON.stringify(loaded.deployment),
          __FACILIS_ENV_VERSION__: JSON.stringify(version),
        };
        // The controller reads this at boot (ide/src/vv/controller.ts); a managed build
        // sets it from its policy unless the operator chose one explicitly.
        const previewOrigin = loaded.deployment.projects.preview.origin;
        if (previewOrigin !== null && process.env.VITE_PREVIEW_ORIGIN === undefined) {
          define["import.meta.env.VITE_PREVIEW_ORIGIN"] = JSON.stringify(previewOrigin);
        }
        if (previewOrigin !== null && process.env.VITE_PREVIEW_POPOUT === undefined) {
          define["import.meta.env.VITE_PREVIEW_POPOUT"] = JSON.stringify("isolated");
        }
        return { define };
      },
      configResolved(config) {
        resolved = config;
      },
      transformIndexHtml: {
        // Runs after vv-precache-and-hints (registered earlier), which adds the registry
        // dns-prefetch hint this rewrites for a managed build.
        order: "post",
        handler: (html) => rewriteRegistryHint(html, loaded.deployment),
      },
      closeBundle() {
        if (resolved === null) return;
        const outDir = path.resolve(resolved.root, resolved.build.outDir);
        // index.html is already written at closeBundle: read it for the inline hashes.
        const indexPath = path.join(outDir, "index.html");
        const inlineScripts = fs.existsSync(indexPath)
          ? inlineScriptHashes(fs.readFileSync(indexPath, "utf8"))
          : [];
        const input: ArtifactInput = {
          deployment: loaded.deployment,
          providerHosts: PROVIDER_BASE_URLS,
          version,
          configHash: loaded.configHash,
          inlineScripts,
        };

        const files: Record<string, string> = {
          "headers.conf": renderHeaders(input),
          "mirror-allowlist.json": renderMirrorAllowlist(loaded.deployment),
          "npmrc.template": renderProjectNpmrc(loaded.deployment),
        };
        for (const [name, text] of Object.entries(files)) {
          fs.writeFileSync(path.join(outDir, name), text);
        }

        // The manifest names every emitted artifact and is written last, so a half-written
        // output directory never carries a complete-looking manifest.
        const skipped = new Set([...Object.keys(files), "environment.json"]);
        const artifacts: Record<string, string> = {};
        for (const file of listFiles(outDir)) {
          if (!skipped.has(file)) artifacts[file] = sha256File(path.join(outDir, file));
        }
        fs.writeFileSync(
          path.join(outDir, "environment.json"),
          renderEnvironment({ ...input, artifacts }),
        );
      },
    },
  ];
}
