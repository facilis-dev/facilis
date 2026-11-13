#!/usr/bin/env node
/**
 * Creates a personal git worktree for hand-editing the code: new branch `<type>/<slug>`,
 * checkout under `.users/worktrees/<type>/<slug>`, started from `main`, while the primary
 * checkout stays on the default branch (AGENTS.md, "Git").
 *
 * The checkout directory is self-ignoring: `.users/worktrees/.gitignore` contains `*`, the
 * same trick as `.agents/worktrees`, so the primary checkout's `git status` stays clean without
 * touching the tracked `.gitignore`.
 *
 * Installed dependency files are hardlinks into the shared pnpm store, so the extra disk cost
 * of the `pnpm install` this script runs is small; pass --no-install to skip it.
 *
 * Usage:
 *   pnpm worktree <type>/<slug> [--from <ref>] [--no-install]
 *   pnpm worktree <type> <slug> [--from <ref>] [--no-install]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

/** Branch types accepted by the repository's `<type>/<slug>` convention. */
const TYPES = ["feat", "fix", "chore", "docs", "refactor", "test", "perf", "build", "ci"];
/** AGENTS.md: every branch is started from main. */
const DEFAULT_BASE = "main";
/** Personal worktrees root, relative to the primary checkout (agents use .agents/worktrees). */
const WORKTREE_ROOT = ".users/worktrees";
/** Kebab-case slug: last branch segment and checkout directory name. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HELP = `Creates a personal git worktree for hand-editing the code.

Usage:
  pnpm worktree <type>/<slug> [--from <ref>] [--no-install]
  pnpm worktree <type> <slug> [--from <ref>] [--no-install]

  Branch:   <type>/<slug>, created from main by default.
  Checkout: .users/worktrees/<type>/<slug> inside the primary checkout.
  Types:    ${TYPES.join(", ")}
  Slug:     lowercase kebab-case, e.g. graph-zoom

Options:
  --from <ref>   start from this commit/branch/tag instead of main (no fetch is run;
                 use --from origin/main to base on the last fetched remote main)
  --no-install   skip "pnpm install" in the new checkout
  --help         show this help

Examples:
  pnpm worktree feat/graph-zoom
  pnpm worktree fix cache-invalidation
  pnpm worktree feat/graph-zoom --from origin/main --no-install`;

function fail(message) {
  console.error(`\n[worktree] FAIL: ${message}\n`);
  process.exit(1);
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    fail(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
    return "";
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const positional = [];
let base = DEFAULT_BASE;
let install = true;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--from" || arg.startsWith("--from=")) {
    base = arg === "--from" ? (argv[(index += 1)] ?? "") : arg.slice("--from=".length);
    if (base === "") fail("--from needs a git ref, e.g. --from origin/main");
  } else if (arg === "--no-install") {
    install = false;
  } else if (arg === "--") {
    // pnpm run passes a bare "--" through as the first script argument.
    continue;
  } else if (arg.startsWith("-")) {
    fail(`unknown option "${arg}" (see --help)`);
  } else {
    positional.push(arg);
  }
}

let type;
let slug;
if (positional.length === 1 && positional[0].includes("/")) {
  const parts = positional[0].split("/");
  if (parts.length !== 2) fail(`invalid branch name "${positional[0]}": expected <type>/<slug>`);
  [type, slug] = parts;
} else if (positional.length === 2) {
  [type, slug] = positional;
} else {
  fail("expected <type>/<slug> or <type> <slug> (see --help)");
}
if (!TYPES.includes(type)) fail(`unknown type "${type}": use one of ${TYPES.join(", ")}`);
if (!SLUG_PATTERN.test(slug)) fail(`invalid slug "${slug}": use lowercase kebab-case, e.g. graph-zoom`);

// Resolve against the primary checkout, so the script behaves the same when run from a
// linked worktree: git worktrees all share one common git dir, which lives in the primary one.
const root = (() => {
  try {
    return dirname(
      execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim(),
    );
  } catch {
    fail("not inside the Facilis git repository");
    return "";
  }
})();

const branch = `${type}/${slug}`;
const target = join(root, WORKTREE_ROOT, type, slug);

// A checkout deleted by hand leaves a registration behind that would block this path.
git(["worktree", "prune"], root);
if (existsSync(target)) fail(`${target} already exists (remove it with: git worktree remove "${target}")`);
const branchExists = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
  cwd: root,
});
if (branchExists.status === 0) fail(`branch ${branch} already exists`);
const baseRef = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], {
  cwd: root,
  encoding: "utf8",
});
if (baseRef.status !== 0) fail(`base ref "${base}" does not exist (fetch it, or use --from <ref>)`);
const baseCommit = baseRef.stdout.trim();

// Self-ignoring worktrees root: keeps the primary checkout's status clean without a tracked
// .gitignore entry, exactly like .agents/worktrees.
mkdirSync(dirname(target), { recursive: true });
const ignoreFile = join(root, WORKTREE_ROOT, ".gitignore");
if (!existsSync(ignoreFile)) writeFileSync(ignoreFile, "*\n");

const added = spawnSync("git", ["worktree", "add", "-b", branch, target, baseCommit], {
  cwd: root,
  encoding: "utf8",
});
if (added.status !== 0) {
  fail(`git worktree add failed${added.stderr ? `: ${added.stderr.trim()}` : ""}`);
}

console.log(`[worktree] branch   ${branch} (from ${base} @ ${baseCommit.slice(0, 7)})`);
console.log(`[worktree] checkout ${target}`);

if (install) {
  console.log("[worktree] installing dependencies: pnpm install (--no-install to skip)");
  const installed = spawnSync("pnpm", ["install"], { cwd: target, stdio: "inherit" });
  if (installed.status !== 0) {
    fail(`pnpm install failed; the checkout exists at ${target}, run pnpm install there`);
  }
}

console.log("\n[worktree] ready. Next:");
console.log(`  cd "${target}"`);
console.log("  pnpm dev   # or pnpm test / pnpm lint / ...");
if (!install) console.log("  pnpm install   # dependencies were skipped");
console.log("\n[worktree] after the PR is merged, from the primary checkout:");
console.log(`  git worktree remove "${target}" && git branch -d ${branch}`);
