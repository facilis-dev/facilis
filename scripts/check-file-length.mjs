#!/usr/bin/env node
/**
 * Fails when a tracked TypeScript source file exceeds MAX_LINES (see AGENTS.md).
 *
 * The limit is intentionally not configurable per file: split the file instead of
 * adding an exclusion. Generated output and dependencies are never counted.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import process from "node:process";

const MAX_LINES = 300;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".git",
  "generated",
  // studio/ is the vendored Vivari fork: upstream-owned code, kept as-is so
  // upstream syncs stay trivial. Facilis code lives outside it.
  "studio",
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

const files = listSourceFiles();
const violations = files
  .map((filePath) => ({ file: relative(repoRoot, filePath), lines: countLines(filePath) }))
  .filter(({ lines }) => lines > MAX_LINES)
  .toSorted((a, b) => b.lines - a.lines);

if (violations.length > 0) {
  console.error(`check-file-length: ${violations.length} file(s) exceed ${MAX_LINES} lines:`);
  for (const { file, lines } of violations) {
    console.error(`  ${lines}  ${file}`);
  }
  process.exitCode = 1;
} else {
  console.log(`check-file-length: OK (${files.length} file(s), limit ${MAX_LINES} lines)`);
}
