#!/usr/bin/env node
// What is released, what npm serves, and what the IDE build pins (D-183).
//
//   pnpm release:status          # human-readable summary
//   pnpm release:status --check  # exit 1 when a tag and npm disagree (CI-friendly)
//
// The version ledger is git: the deploy workflow creates the tag `vX.Y.Z` for every
// published version, at the commit that produced it (D-183). npm is the distribution, so
// the two drifts worth seeing are a version on npm with no tag (a publish that died
// before tagging) and a tag whose version npm does not serve (a publish that never
// happened). Lockstep is checked too: one version covers every package.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const SCOPE = "@facilis.dev/";
const TAG_RE = /^v(\d+\.\d+\.\d+)$/;
const check = process.argv.includes("--check");

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function packageNames() {
  return fs
    .readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(REPO_ROOT, "packages", entry.name, "package.json"))
    .filter((manifest) => fs.existsSync(manifest))
    .map((manifest) => JSON.parse(fs.readFileSync(manifest, "utf8")))
    .filter((pkg) => typeof pkg.name === "string" && pkg.name.startsWith(SCOPE) && !pkg.private)
    .map((pkg) => pkg.name.slice(SCOPE.length))
    .toSorted();
}

async function npmLatest(name) {
  try {
    const response = await fetch(REGISTRY + "/" + encodeURIComponent(SCOPE + name), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return { version: null };
    if (!response.ok) return { error: "HTTP " + response.status };
    const doc = await response.json();
    return { version: doc["dist-tags"]?.latest ?? null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const names = packageNames();
const tags = (git(["tag", "--list", "v*", "--sort=-v:refname"]) ?? "")
  .split("\n")
  .map((tag) => tag.trim());
const tag = tags.find((candidate) => TAG_RE.test(candidate)) ?? null;
const tagVersion = tag ? TAG_RE.exec(tag)[1] : null;
const tagCommit = tag ? git(["rev-list", "-n", "1", tag]) : null;
const headCommit = git(["rev-parse", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD";
const ahead = tag ? Number(git(["rev-list", "--count", `${tag}..HEAD`]) ?? "0") : 0;
// A local dev build has no FACILIS_PACKAGES_VERSION; the fallback lives in the IDE source,
// so read it there rather than keeping a second copy of the number here.
const devFallback =
  /frameworkPackagesVersion[\s\S]*?:\s*"([^"]+)"/.exec(
    fs.readFileSync(path.join(REPO_ROOT, "ide/src/deploy/current.ts"), "utf8"),
  )?.[1] ?? "unknown";
const pinned = process.env.FACILIS_PACKAGES_VERSION || tagVersion || devFallback;

const results = await Promise.all(names.map(npmLatest));
const errored = results.find((result) => result.error);
const versions = new Set(results.map((result) => result.version).filter(Boolean));
const published = versions.size === 0 ? null : versions.size === 1 ? [...versions][0] : "mixed";

const pad = (label) => label.padEnd(12);
const lines = ["Facilis releases — tag = published version (D-183)", ""];
lines.push(
  pad("last tag") +
    (tag ? `${tag}  ${tagCommit.slice(0, 7)}  ${git(["log", "-1", "--format=%cs", tag])}` : "none"),
);
lines.push(
  pad("HEAD") +
    `${branch} ${headCommit.slice(0, 7)}` +
    (tag
      ? tagCommit === headCommit
        ? "  (at the tag)"
        : `  (${ahead} commit${ahead === 1 ? "" : "s"} after the tag)`
      : ""),
);
lines.push(
  pad("npm latest") +
    (errored
      ? "unreachable: " + errored.error
      : published === null
        ? "nothing published"
        : published === "mixed"
          ? [...versions].join(", ") + "  (packages out of lockstep)"
          : `${published}  (${names.length} packages)`),
);
lines.push(
  pad("IDE pin") +
    pinned +
    (process.env.FACILIS_PACKAGES_VERSION
      ? "  (FACILIS_PACKAGES_VERSION)"
      : tag
        ? "  (from the tag)"
        : "  (dev default; the deployed build injects its published version)"),
);

const problems = [];
if (errored) problems.push("npm registry unreachable: " + errored.error);
if (published === "mixed") problems.push("packages disagree on the published version");
if (published && published !== "mixed") {
  if (!tagVersion) {
    problems.push(
      `npm serves ${published} but nothing is tagged: tag it (gh release create v${published} --target <sha>)`,
    );
  } else if (tagVersion !== published) {
    problems.push(
      `npm serves ${published} but the last tag is v${tagVersion}: tag the published version`,
    );
  }
}
if (tagVersion && !published && !errored) {
  problems.push(`v${tagVersion} is tagged but npm serves no package at that version`);
}
if (
  tagVersion &&
  process.env.FACILIS_PACKAGES_VERSION &&
  process.env.FACILIS_PACKAGES_VERSION !== tagVersion
) {
  problems.push(
    `the IDE build pins ${process.env.FACILIS_PACKAGES_VERSION}, the last tag is v${tagVersion}`,
  );
}

console.log(lines.join("\n"));
if (problems.length === 0) {
  console.log("\n✓ the tag, npm and the IDE pin agree");
} else {
  console.log("\n" + problems.map((problem) => "⚠ " + problem).join("\n"));
}
process.exit(check && problems.length > 0 ? 1 : 0);
