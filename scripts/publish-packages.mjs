#!/usr/bin/env node
// Publish the Facilis workspace packages to npm under the @facilis.dev scope (D-164).
//
// Called by .github/workflows/deploy-ide.yml on every release and usable locally:
//   pnpm publish:packages            # build, stage, publish
//   pnpm publish:dry-run             # build, stage, npm publish --dry-run
//
// The workspace manifest is not publishable as-is: exports point at src/*.ts (bundlers strip
// types there, Node refuses type stripping under node_modules) and internal deps use the
// workspace: protocol. So each package is staged into a temp dir with a rewritten manifest
// (exports -> dist/*.js, deps pinned to the release version, devDependencies and scripts
// dropped, README/LICENSE copied in) and published from that directory. The workspace tree is
// never modified, so local development keeps resolving sources (D-164).
//
// Versioning: every package releases in lockstep. The next version is the highest version
// already on npm bumped by a patch; the workspace placeholder (0.0.0) only seeds the first
// release. If a release died halfway, the retry picks a version no package has yet, so the
// nine packages stay on the same version.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const SCOPE = "@facilis.dev/";
const FIRST_VERSION = "0.1.0";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const skipBuild = argv.includes("--skip-build");
const versionAt = argv.indexOf("--version");
const requestedVersion =
  versionAt === -1 ? process.env.FACILIS_PUBLISH_VERSION : argv[versionAt + 1];

function fail(message) {
  console.error("[publish] FAIL: " + message);
  process.exit(1);
}

function run(command, args, cwd = REPO_ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) fail("cannot run " + command + ": " + result.error.message);
  if (result.status !== 0) fail(command + " " + args.join(" ") + " exited with " + result.status);
}

function discoverPackages() {
  const packagesDir = path.join(REPO_ROOT, "packages");
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(packagesDir, entry.name);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      return { dir, name: manifest.name, manifest };
    })
    .filter(
      (pkg) => typeof pkg.name === "string" && pkg.name.startsWith(SCOPE) && !pkg.manifest.private,
    )
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function publishedMetadata(name, bustCache = false) {
  const url = REGISTRY + "/" + encodeURIComponent(name) + (bustCache ? "?t=" + Date.now() : "");
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) fail("registry lookup for " + name + " returned HTTP " + response.status);
  return response.json();
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) fail("unparseable version " + version);
  return match.slice(1, 4).map(Number);
}

function formatVersion(parts) {
  return parts.join(".");
}

function bumpPatch(parts) {
  return [parts[0], parts[1], parts[2] + 1];
}

function isNewer(a, b) {
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

async function resolveVersion(packages) {
  if (requestedVersion) {
    if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(requestedVersion))
      fail("--version " + requestedVersion + " is not semver");
    return requestedVersion;
  }
  const published = new Map();
  let highest = null;
  for (const pkg of packages) {
    const metadata = await publishedMetadata(pkg.name);
    published.set(pkg.name, metadata ? Object.keys(metadata.versions ?? {}) : []);
    const latest = metadata?.["dist-tags"]?.latest;
    if (latest) {
      const parts = parseVersion(latest);
      if (highest === null || isNewer(parts, highest)) highest = parts;
    }
  }
  if (highest === null) return FIRST_VERSION;
  let candidate = bumpPatch(highest);
  const taken = (version) => [...published.values()].some((versions) => versions.includes(version));
  while (taken(formatVersion(candidate))) candidate = bumpPatch(candidate);
  return formatVersion(candidate);
}

const toDist = (value) =>
  typeof value === "string" && value.startsWith("./src/")
    ? "./dist/" + value.slice("./src/".length).replace(/\.ts$/, ".js")
    : value;

function rewriteTargets(node) {
  if (typeof node === "string") return toDist(node);
  if (Array.isArray(node)) return node.map(rewriteTargets);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, rewriteTargets(value)]),
    );
  }
  return node;
}

function pinWorkspace(dependencies, version) {
  if (!dependencies) return dependencies;
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, spec]) => [
      name,
      spec.startsWith("workspace:") ? version : spec,
    ]),
  );
}

// Test modules are not part of the published surface: they import vitest (a devDependency the
// published manifest drops), and shipping them only invites consumers to load them.
const TEST_ARTIFACT =
  /(?:^|\/)(?:[^/]+\.test\.[^/]+|[^/]+\.test-fixtures\.[^/]+|test-fixtures)(?:\/|$)/;

function copyDir(from, to, skipTests) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => !skipTests || !TEST_ARTIFACT.test(source.slice(from.length + 1)),
  });
}

// Declaration emit keeps the source specifier ("./tasks.ts"), which resolves neither in the
// tarball nor through the exports map. Point it at the emitted .js (TypeScript maps .js to
// the sibling .d.ts).
function fixDeclarationSpecifiers(distDir) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(target);
        continue;
      }
      if (!target.endsWith(".d.ts")) continue;
      const before = fs.readFileSync(target, "utf8");
      const after = before
        .replace(
          /^((?:import|export)[^;\n]*?from\s+["'])(\.{1,2}\/[^"']+)\.ts(["'])/gm,
          "$1$2.js$3",
        )
        .replace(/(import\(\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
      if (after !== before) fs.writeFileSync(target, after);
    }
  };
  walk(distDir);
}

function stagePackage(pkg, version) {
  const distDir = path.join(pkg.dir, "dist");
  if (!fs.existsSync(distDir)) fail(pkg.name + " has no dist/: run the build first");
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "facilis-publish-"));
  copyDir(distDir, path.join(stage, "dist"), true);
  fixDeclarationSpecifiers(path.join(stage, "dist"));
  if (fs.existsSync(path.join(pkg.dir, "src")))
    copyDir(path.join(pkg.dir, "src"), path.join(stage, "src"), true);
  for (const asset of ["README.md", "LICENSE"]) {
    const source =
      asset === "LICENSE" ? path.join(REPO_ROOT, "LICENSE") : path.join(pkg.dir, asset);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stage, asset));
  }

  const manifest = { ...pkg.manifest, version, exports: rewriteTargets(pkg.manifest.exports) };
  const rootEntry = manifest.exports?.["."];
  if (
    typeof rootEntry === "string" &&
    rootEntry.startsWith("./dist/") &&
    rootEntry.endsWith(".js")
  ) {
    manifest.main = rootEntry;
    manifest.types = rootEntry.slice(0, -3) + ".d.ts";
  }
  manifest.dependencies = pinWorkspace(manifest.dependencies, version);
  manifest.publishConfig = { ...manifest.publishConfig, access: "public" };
  manifest.files = ["dist", "src", "README.md", "LICENSE"];
  delete manifest.devDependencies;
  delete manifest.scripts;
  delete manifest.packageManager;
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  if (serialized.includes("workspace:")) fail(pkg.name + " still has a workspace: specifier");
  if (serialized.includes('"./src/') && serialized.includes('"exports"'))
    fail(pkg.name + " exports still target src/");
  fs.writeFileSync(path.join(stage, "package.json"), serialized);
  return { stage, manifest };
}

function verifyStaged(stage, manifest) {
  const rootEntry = manifest.exports?.["."];
  if (typeof rootEntry !== "string") fail(manifest.name + " has no root export entry");
  for (const file of [rootEntry, manifest.types, "README.md", "LICENSE"]) {
    if (!file || !fs.existsSync(path.join(stage, file)))
      fail(manifest.name + " is missing " + file + " in the staged package");
  }
}

// npm exiting 0 only means the registry accepted the upload: it serves a new version after a
// delay (a first release took ~2 min), so poll until every package reports it as `latest`.
// A stage-only token never gets there — it stages a 0.0.0 placeholder — hence the error text.
async function verifyPublished(packages, version) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const metadata = await Promise.all(packages.map((pkg) => publishedMetadata(pkg.name, true)));
    const stale = packages.filter((_, index) => metadata[index]?.["dist-tags"]?.latest !== version);
    if (stale.length === 0) {
      console.log("[publish] verified " + version + " as latest on npm");
      return;
    }
    if (attempt === 12) {
      fail(
        "registry does not serve " +
          version +
          " as latest for " +
          stale.map((pkg) => pkg.name).join(", ") +
          ": a stage-only npm token stages versions (a 0.0.0 placeholder) instead of publishing them",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  }
}

async function main() {
  const packages = discoverPackages();
  if (packages.length === 0) fail("no " + SCOPE + "* packages found under packages/");
  const version = await resolveVersion(packages);
  console.log(
    "[publish] " + packages.length + " packages -> " + version + (dryRun ? " (dry run)" : ""),
  );

  if (!skipBuild) run("pnpm", ["exec", "turbo", "run", "build", "--filter=./packages/*"]);
  // CI authenticates with trusted publishing: the job's GitHub OIDC token becomes the publish
  // credential, with no token in the environment. A token would take precedence over that
  // exchange, so a run with neither is a local `npm login`.
  if (
    !dryRun &&
    !process.env.NODE_AUTH_TOKEN &&
    !process.env.NPM_TOKEN &&
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  ) {
    console.warn("[publish] no npm token and no OIDC request URL: relying on the local npm login");
  }

  for (const pkg of packages) {
    const { stage, manifest } = stagePackage(pkg, version);
    verifyStaged(stage, manifest);
    if (dryRun) {
      const summary = {
        name: manifest.name,
        version: manifest.version,
        main: manifest.main,
        types: manifest.types,
        dependencies: manifest.dependencies,
        exports: manifest.exports,
      };
      console.log("[publish] staged " + JSON.stringify(summary));
    }
    console.log("[publish] publishing " + manifest.name + "@" + version);
    const args = ["publish", stage, "--access", "public", "--tag", "latest"];
    if (dryRun) args.push("--dry-run");
    try {
      run("npm", args);
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  if (!dryRun) await verifyPublished(packages, version);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "version=" + version + "\n");
  }
  console.log("[publish] done: " + packages.length + " packages at " + version);
}

await main();
