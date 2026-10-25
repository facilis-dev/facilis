#!/usr/bin/env node
/**
 * Fails when a tracked TypeScript source file exceeds MAX_LINES (see AGENTS.md).
 *
 * The limit is not configurable per file: split the file instead of adding an exclusion.
 * Generated output, dependencies and the read-only vendor/ submodule are never counted.
 *
 * The single exception is the upstream-derived IDE import: files that arrived from Vivari
 * above the limit are listed in scripts/file-length-baseline.json at their import size. It is
 * a **ratchet** — a listed file may shrink but not grow, entries disappear as the files are
 * split, and new files can never be added. --update-baseline re-records the sizes after a
 * deliberate upstream import (review that diff like code).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import process from "node:process";

const MAX_LINES = 300;
const BASELINE_FILE = "scripts/file-length-baseline.json";
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".git",
  "generated",
  // vendor/ is a read-only upstream submodule: never counted, never edited here.
  "vendor",
  ".worktrees",
]);

const repoRoot = process.cwd();

function isIgnored(relativePath) {
  return relativePath.split(sep).some((segment) => IGNORED_SEGMENTS.has(segment));
}

function listFromGit() {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return output.split("\0").filter(Boolean);
}

function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_SEGMENTS.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, found);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      found.push(fullPath);
    }
  }
  return found;
}

function listSourceFiles() {
  try {
    return (
      listFromGit()
        .filter((file) => SOURCE_EXTENSIONS.has(extname(file)) && !isIgnored(file))
        .map((file) => join(repoRoot, file))
        // The git index can still list a file that was deleted on disk mid-refactor;
        // it is not part of the tree being checked, so skip it instead of crashing.
        .filter((file) => existsSync(file))
    );
  } catch {
    return walk(repoRoot);
  }
}

function countLines(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) return 0;
  const lines = content.split(/\r?\n/);
  return content.endsWith("\n") ? lines.length - 1 : lines.length;
}

function readBaseline() {
  const path = join(repoRoot, BASELINE_FILE);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

const files = listSourceFiles().map((filePath) => ({
  file: relative(repoRoot, filePath).split(sep).join("/"),
  lines: countLines(filePath),
}));
const baseline = readBaseline();
const overLimit = files.filter(({ lines }) => lines > MAX_LINES);

if (UPDATE_BASELINE) {
  const next = Object.fromEntries(overLimit.map(({ file, lines }) => [file, lines]));
  writeFileSync(join(repoRoot, BASELINE_FILE), JSON.stringify(next, null, 2) + "\n");
  console.log(`check-file-length: baseline updated (${overLimit.length} file(s))`);
  process.exit(0);
}

const violations = [];
for (const { file, lines } of overLimit) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    violations.push({
      file,
      lines,
      reason: `${lines} lines: above the limit and not in the upstream baseline`,
    });
  } else if (lines > allowed) {
    violations.push({
      file,
      lines,
      reason: `${lines} lines: grew past its baseline of ${allowed} (split it)`,
    });
  }
}
for (const file of Object.keys(baseline)) {
  const current = files.find((entry) => entry.file === file);
  if (current === undefined) {
    violations.push({ file, lines: 0, reason: "baseline entry no longer exists (remove it)" });
  } else if (current.lines <= MAX_LINES) {
    violations.push({
      file,
      lines: current.lines,
      reason: `now ${current.lines} lines: drop it from the baseline (ratchet)`,
    });
  }
}

if (violations.length > 0) {
  console.error(`check-file-length: ${violations.length} violation(s):`);
  for (const { file, reason } of violations) console.error(`  ${file}: ${reason}`);
  process.exitCode = 1;
} else {
  console.log(
    `check-file-length: OK (${files.length} file(s), limit ${MAX_LINES} lines, ` +
      `${Object.keys(baseline).length} baseline entr(y/ies))`,
  );
}
