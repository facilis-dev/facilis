#!/usr/bin/env node
// What is committed, what npm serves, and where the two drift (D-198).
//
//   pnpm release:status   # per-package committed version vs npm latest
//
// The source of truth is the committed packages/*/package.json manifests: a release
// publishes exactly those versions (D-198). Exit semantics: NON-ZERO when any package's
// committed version differs from npm's latest dist-tag (a bump not yet published, or npm
// ahead of this checkout), when a package is unpublished, or when the registry is
// unreachable; zero when every package is in sync. The old --check flag is accepted but
// redundant — drift always fails. The last git tag is information only: it names the
// headline of the last released set, not a per-package truth (D-183, amended by D-198).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org";
const SCOPE = "@facilis.dev/";
const TAG_RE = /^v(\d+\.\d+\.\d+)$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parseSemver(version) {
  const match = typeof version === "string" ? SEMVER_RE.exec(version) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function collectCommitted(manifests) {
  return manifests
    .filter((m) => typeof m?.name === "string" && m.name.startsWith(SCOPE) && !m.private)
    .map(({ name, version }) => ({ name, committed: version }))
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

// latest is { version: string | null } on a registry answer, { error: string } on a failure.
export function assessPackage({ name, committed }, latest) {
  const base = { name, committed, latest: null };
  if (!parseSemver(committed))
    return {
      ...base,
      state: "invalid",
      problem: name + ": committed version " + JSON.stringify(committed) + " is not semver",
    };
  if (latest.error)
    return {
      ...base,
      state: "unreachable",
      problem: name + ": npm registry unreachable: " + latest.error,
    };
  if (latest.version == null)
    return {
      ...base,
      state: "unpublished",
      problem: name + ": committed " + committed + " but nothing is published on npm",
    };
  if (latest.version === committed) return { ...base, latest: latest.version, state: "in-sync" };
  const latestParts = parseSemver(latest.version);
  if (!latestParts)
    return {
      ...base,
      latest: latest.version,
      state: "drift",
      problem: name + ": npm latest " + JSON.stringify(latest.version) + " is not semver",
    };
  const direction = compareSemver(parseSemver(committed), latestParts) > 0 ? "ahead of" : "behind";
  return {
    ...base,
    latest: latest.version,
    state: "drift",
    problem:
      name +
      ": committed " +
      committed +
      ", npm latest " +
      latest.version +
      " (checkout " +
      direction +
      " npm)",
  };
}

export function driftProblems(rows) {
  return rows.map((row) => row.problem).filter(Boolean);
}

const pad = (label) => label.padEnd(24);

export function renderStatusReport(rows, info) {
  const lines = ["Facilis releases — committed manifests are the truth (D-198)", ""];
  if (info) {
    lines.push(
      pad("last tag") +
        (info.tag
          ? info.tag + "  " + (info.tagCommit ?? "").slice(0, 7) + "  " + info.tagDate
          : "none") +
        "  (info: headline of the last released set)",
    );
    lines.push(
      pad("HEAD") +
        info.branch +
        " " +
        (info.headCommit ?? "").slice(0, 7) +
        (info.tag
          ? info.tagCommit === info.headCommit
            ? "  (at the tag)"
            : "  (" + info.ahead + " commit" + (info.ahead === 1 ? "" : "s") + " after the tag)"
          : ""),
    );
    lines.push("");
  }
  lines.push(pad("package") + "committed     npm latest    state");
  for (const row of rows)
    lines.push(
      pad(row.name) + row.committed.padEnd(13) + (row.latest ?? "—").padEnd(13) + row.state,
    );
  return lines;
}

export async function npmLatest(name) {
  try {
    const response = await fetch(REGISTRY + "/" + encodeURIComponent(name), {
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

function readManifests() {
  const packagesDir = path.join(REPO_ROOT, "packages");
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, "package.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Informational only: the tag names the headline of the last released set, while the
// per-package truth is the committed manifests vs npm (D-198).
function gitInfo() {
  const tags = (git(["tag", "--list", "v*", "--sort=-v:refname"]) ?? "")
    .split("\n")
    .map((t) => t.trim());
  const tag = tags.find((candidate) => TAG_RE.test(candidate)) ?? null;
  const tagCommit = tag ? git(["rev-list", "-n", "1", tag]) : null;
  const headCommit = git(["rev-parse", "HEAD"]);
  return {
    tag,
    tagCommit,
    tagDate: tag ? git(["log", "-1", "--format=%cs", tag]) : null,
    headCommit,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD",
    ahead: tag ? Number(git(["rev-list", "--count", tag + "..HEAD"]) ?? "0") : 0,
  };
}

export async function main() {
  const committed = collectCommitted(readManifests());
  if (committed.length === 0) {
    console.error("[release-status] no " + SCOPE + "* packages found under packages/");
    process.exit(1);
  }
  const rows = await Promise.all(
    committed.map(async (entry) => assessPackage(entry, await npmLatest(entry.name))),
  );
  console.log(renderStatusReport(rows, gitInfo()).join("\n"));
  const problems = driftProblems(rows);
  if (problems.length === 0) {
    console.log("\n✓ every committed version matches npm latest");
  } else {
    console.log("\n" + problems.map((problem) => "⚠ " + problem).join("\n"));
    process.exit(1);
  }
}

// Importable helpers for the tests; main runs only when executed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      "[release-status] FAIL: " + (error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  });
}
