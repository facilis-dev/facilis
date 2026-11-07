#!/usr/bin/env node
// Applies a fixture tree over a scratch copy of examples/todo-app and typechecks it.
//
// A fixture mirrors the generated-project tree under scripts/dev/fixtures/<name>/project/,
// so a file in the fixture replaces (or adds) the same path in the project. This is how the
// "resource section" standard (docs/PATTERNS.md) is kept compilable without shipping it in
// the example app yet.
//
// Usage: node --experimental-strip-types scripts/dev/fixtures-check.mjs [fixture]

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const EXAMPLE = join(REPO, "examples/todo-app");
const TSC = join(EXAMPLE, "node_modules", ".bin", "tsc");
// Inside the example tree on purpose: tsc resolves the project's deps from the enclosing
// node_modules and @types/node from the repo root.
const SCRATCH = join(EXAMPLE, ".fixtures-check");
const SKIP = new Set(["node_modules", ".output", ".turbo", ".git", ".ai-eval", ".fixtures-check"]);
const MAX_LINES = 300;

const fixtureName = process.argv[2] ?? "section-standard";
const fixtureRoot = join(REPO, "scripts/dev/fixtures", fixtureName, "project");

function copyTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function overlay(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      overlay(from, to);
    } else if (entry.isFile()) {
      mkdirSync(join(to, ".."), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function fixtureFiles(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) fixtureFiles(full, found);
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** Files over the repo limit would fail the root gate even as fixtures. */
function checkLengths() {
  const violations = [];
  for (const file of fixtureFiles(fixtureRoot)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n").length;
    if (lines > MAX_LINES) violations.push(file.replace(REPO, "") + " (" + lines + " lines)");
  }
  return violations;
}

/** The two catalogues must carry exactly the same keys (FRONTEND.md section 6). */
function checkLocales() {
  const en = join(fixtureRoot, "locales/en.json");
  const it = join(fixtureRoot, "locales/it.json");
  if (!existsSync(en) || !existsSync(it)) return ["locales/en.json or locales/it.json missing in fixture"];
  const parse = (file) => JSON.parse(readFileSync(file, "utf8"));
  const enKeys = Object.keys(parse(en)).toSorted();
  const itKeys = Object.keys(parse(it)).toSorted();
  const problems = [];
  for (const key of enKeys) if (!itKeys.includes(key)) problems.push("it.json missing " + key);
  for (const key of itKeys) if (!enKeys.includes(key)) problems.push("en.json missing " + key);
  return problems;
}

function main() {
  if (!existsSync(fixtureRoot)) throw new Error("unknown fixture: " + fixtureName);
  const missing = checkLocales();
  const tooLong = checkLengths();
  rmSync(SCRATCH, { recursive: true, force: true });
  copyTree(EXAMPLE, SCRATCH);
  overlay(fixtureRoot, SCRATCH);
  const tsconfigPath = join(SCRATCH, "tsconfig.json");
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  tsconfig.extends = join(REPO, "tsconfig.base.json");
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
  const result = spawnSync(TSC, ["-p", "tsconfig.json", "--noEmit"], {
    cwd: SCRATCH,
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const errors = output.split("\n").filter((line) => line.includes("error TS"));
  rmSync(SCRATCH, { recursive: true, force: true });
  for (const problem of missing) console.log("[locales] " + problem);
  for (const violation of tooLong) console.log("[length] " + violation + " > " + MAX_LINES);
  console.log("fixture " + fixtureName + " -> " + (result.status === 0 ? "typecheck ok" : "typecheck FAILED"));
  if (result.status !== 0) {
    for (const line of errors.slice(0, 40)) console.log(line.replace(SCRATCH + "/", ""));
    process.exitCode = 1;
  }
}

main();
