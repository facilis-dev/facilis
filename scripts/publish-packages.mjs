#!/usr/bin/env node
// Publish the Facilis workspace packages to npm under the @facilis.dev scope (D-164/D-198).
// Versioning (D-198): each package publishes EXACTLY the version committed in its
// packages/*/package.json — a minor/major release is a manifest edit in a PR, not a flag.
// Placeholder (0.0.0), unparseable or already-published versions fail the run, so a retry
// never mints a second version. Internal workspace:* deps pin to the TARGET package's
// committed version; versions may diverge, there is no lockstep. --dry-run rehearses staging
// and skips the script's registry pre-check; npm publish --dry-run itself still refuses a
// version already on npm — after a release that is the expected "nothing to publish" answer.
// The workspace manifest is not publishable as-is (exports point at src/*.ts, deps use
// workspace:), so each package is staged into a temp dir — exports -> dist/*.js, devDeps and
// scripts dropped, README/LICENSE copied, test files filtered — and published from there.
// The workspace tree is never modified, so local development keeps resolving sources (D-164).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const SCOPE = "@facilis.dev/";
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function fail(message) {
  console.error(`[publish] FAIL: ${message}`);
  process.exit(1);
}

function run(command, args, cwd = REPO_ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) fail(`cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status}`);
}

export function parseSemver(version) {
  const match = typeof version === "string" ? SEMVER_RE.exec(version) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
export function compareSemver(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// The committed manifests are the release: validate them before anything is built or uploaded.
export function resolveReleaseSet(manifests) {
  const set = [];
  for (const manifest of manifests) {
    const { name, version } = manifest ?? {};
    if (typeof name !== "string" || !name.startsWith(SCOPE))
      throw new Error(`not a ${SCOPE}* package manifest: ${JSON.stringify(name)}`);
    const parts = parseSemver(version);
    if (!parts)
      throw new Error(`${name}: committed version ${JSON.stringify(version)} is not semver`);
    if (parts.every((part) => part === 0))
      throw new Error(`${name}: ${version} is the 0.0.0 placeholder — bump the manifest in a PR`);
    if (set.some((entry) => entry.name === name)) throw new Error(`duplicate package ${name}`);
    set.push({ name, version });
  }
  if (set.length === 0) throw new Error(`no ${SCOPE}* packages found under packages/`);
  return set.toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

export function assertPublishable(set, existingVersionsByName) {
  for (const { name, version } of set) {
    if ((existingVersionsByName[name] ?? []).includes(version))
      throw new Error(`${name}@${version} already exists on npm — a release is a manifest edit`);
  }
}

// The tag names the set by its highest version; the release notes carry the full ledger.
export function headlineVersion(set) {
  let best = set[0];
  for (const entry of set)
    if (compareSemver(parseSemver(entry.version), parseSemver(best.version)) > 0) best = entry;
  return best.version;
}
export function renderReleaseLedger(set) {
  return set.map(({ name, version }) => `${name}@${version}`).join("\n");
}
export function verifyReleaseLedger(body, set) {
  const entries = set.map(({ name, version }) => `${name}@${version}`);
  const missing = entries.filter((entry) => !body.includes(entry));
  return { ok: missing.length === 0, missing };
}

export function pinWorkspace(dependencies, versionByName) {
  if (!dependencies) return dependencies;
  const pin = ([name, spec]) => {
    if (typeof spec !== "string" || !spec.startsWith("workspace:")) return [name, spec];
    const target = versionByName[name];
    if (!target) throw new Error(`workspace dep ${name} is not in the release set`);
    return [name, target];
  };
  return Object.fromEntries(Object.entries(dependencies).map(pin));
}
function discoverPackages() {
  const packagesDir = path.join(REPO_ROOT, "packages");
  const packages = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const { name } = manifest;
    if (typeof name === "string" && name.startsWith(SCOPE) && !manifest.private)
      packages.push({ dir, name, manifest });
  }
  return packages.toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

export async function publishedMetadata(name) {
  const response = await fetch(REGISTRY + "/" + encodeURIComponent(name), {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`registry lookup for ${name} returned HTTP ${response.status}`);
  return response.json();
}
// .tsx entries (@facilis.dev/rum's ./react) emit as .js exactly like .ts ones.
const toDist = (value) =>
  typeof value === "string" && value.startsWith("./src/")
    ? `./dist/${value.slice("./src/".length).replace(/\.tsx?$/, ".js")}`
    : value;
function rewriteTargets(node) {
  if (typeof node === "string") return toDist(node);
  if (Array.isArray(node)) return node.map(rewriteTargets);
  if (node && typeof node === "object") {
    const entries = Object.entries(node).map(([key, value]) => [key, rewriteTargets(value)]);
    return Object.fromEntries(entries);
  }
  return node;
}

// Test modules import vitest (a devDependency the published manifest drops): never ship them.
const TEST_ARTIFACT =
  /(?:^|\/)(?:[^/]+\.test\.[^/]+|[^/]+\.test-fixtures\.[^/]+|test-fixtures)(?:\/|$)/;

function copyDir(from, to, skipTests) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => !skipTests || !TEST_ARTIFACT.test(source.slice(from.length + 1)),
  });
}

// Declaration emit keeps "./tasks.ts" specifiers, which resolve nowhere: point at the .js.
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

export function stagePackage(pkg, versionByName) {
  const distDir = path.join(pkg.dir, "dist");
  if (!fs.existsSync(distDir)) fail(`${pkg.name} has no dist/: run the build first`);
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
  // The committed version IS the published version (D-198); only the layout is rewritten.
  const manifest = { ...pkg.manifest, exports: rewriteTargets(pkg.manifest.exports) };
  const rootEntry = manifest.exports?.["."];
  if (typeof rootEntry === "string" && /^\.\/dist\/.*\.js$/.test(rootEntry)) {
    manifest.main = rootEntry;
    manifest.types = rootEntry.slice(0, -3) + ".d.ts";
  }
  manifest.dependencies = pinWorkspace(manifest.dependencies, versionByName);
  manifest.publishConfig = { ...manifest.publishConfig, access: "public" };
  manifest.files = ["dist", "src", "README.md", "LICENSE"];
  delete manifest.devDependencies;
  delete manifest.scripts;
  delete manifest.packageManager;
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  if (serialized.includes("workspace:")) fail(`${pkg.name} still has a workspace: specifier`);
  if (serialized.includes('"./src/') && serialized.includes('"exports"'))
    fail(`${pkg.name} exports still target src/`);
  fs.writeFileSync(path.join(stage, "package.json"), serialized);
  // The staged tarball must actually contain what the manifest promises before npm sees it.
  if (typeof rootEntry !== "string") fail(`${pkg.name} has no root export entry`);
  for (const file of [rootEntry, manifest.types, "README.md", "LICENSE"]) {
    if (!file || !fs.existsSync(path.join(stage, file)))
      fail(`${pkg.name} is missing ${file} in the staged package`);
  }
  return { stage, manifest };
}

// npm accepts the upload before serving it: the latest dist-tag catches up minutes later,
// per package. Poll the origin-served dist-tags endpoint until each reports ITS OWN committed
// version; failing is deliberate — the IDE pins these exact versions (see D-166).
const VERIFY_TIMEOUT_MS = 8 * 60_000;
const VERIFY_INTERVAL_MS = 10_000;

async function distTags(name) {
  const url = `${REGISTRY}/-/package/${encodeURIComponent(name)}/dist-tags?t=${Date.now()}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const describe = (entries) => entries.map(({ name, version }) => `${name}@${version}`).join(", ");

async function verifyPublished(set) {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  for (let attempt = 1; ; attempt++) {
    // A failed lookup counts as "not there yet": a transient registry error must not fail the
    // release, and a permanent one still ends at the deadline with the right message.
    const tags = await Promise.all(set.map(({ name }) => distTags(name).catch(() => null)));
    const stale = set.filter(({ version }, index) => tags[index]?.latest !== version);
    if (stale.length === 0) {
      console.log("[publish] verified every package at its committed version as latest on npm");
      return;
    }
    if (Date.now() >= deadline)
      fail(
        `registry still does not serve ${describe(stale)} as latest ${VERIFY_TIMEOUT_MS / 60_000} min after upload — usually npm lag, not a lost upload: check pnpm release:status, re-run the deploy once visible.`,
      );
    if (attempt === 1 || attempt % 6 === 0)
      console.log(`[publish] waiting (${attempt}): ${describe(stale)} not latest yet`);
    await new Promise((resolve) => setTimeout(resolve, VERIFY_INTERVAL_MS));
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dryRun = argv.includes("--dry-run");
  const skipBuild = argv.includes("--skip-build");
  if (argv.includes("--version")) fail("--version was removed (D-198): edit the manifests in a PR");
  if (env.FACILIS_PUBLISH_VERSION)
    fail("FACILIS_PUBLISH_VERSION was removed (D-198): edit the manifests in a PR");
  const packages = discoverPackages();
  const set = resolveReleaseSet(packages.map((pkg) => pkg.manifest));
  const versionByName = Object.fromEntries(set.map(({ name, version }) => [name, version]));
  const headline = headlineVersion(set);
  console.log(`[publish] ${set.length} packages, headline ${headline}${dryRun ? " (dry)" : ""}`);

  // Refuse an already-published set before the long build, not after it (D-198).
  if (!dryRun) {
    const docs = await Promise.all(set.map(({ name }) => publishedMetadata(name)));
    const existing = {};
    set.forEach(({ name }, index) => {
      existing[name] = docs[index] ? Object.keys(docs[index].versions ?? {}) : [];
    });
    assertPublishable(set, existing);
  }
  if (!skipBuild) run("pnpm", ["exec", "turbo", "run", "build", "--filter=./packages/*"]);
  // CI uses trusted publishing (OIDC); a token would take precedence, so neither = npm login.
  if (!dryRun && !env.NODE_AUTH_TOKEN && !env.NPM_TOKEN && !env.ACTIONS_ID_TOKEN_REQUEST_URL)
    console.warn("[publish] no npm token and no OIDC request URL: relying on the local npm login");

  for (const pkg of packages) {
    const { stage, manifest } = stagePackage(pkg, versionByName);
    if (dryRun)
      console.log(
        `[publish] staged ${manifest.name}@${manifest.version} deps=${JSON.stringify(manifest.dependencies)} exports=${JSON.stringify(manifest.exports)}`,
      );
    console.log(`[publish] publishing ${manifest.name}@${manifest.version}`);
    const args = ["publish", stage, "--access", "public", "--tag", "latest"];
    if (dryRun) args.push("--dry-run");
    try {
      run("npm", args);
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  if (!dryRun) await verifyPublished(set);
  // version = headline keeps the tag step working; set = the full ledger for the release notes.
  if (env.GITHUB_OUTPUT) {
    const output = `version=${headline}\nset=${JSON.stringify(versionByName)}\n`;
    fs.appendFileSync(env.GITHUB_OUTPUT, output);
  }
  console.log(`[publish] done: ${set.length} packages (headline ${headline})`);
}

// Importable helpers for the tests and the workflow; main runs only when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
