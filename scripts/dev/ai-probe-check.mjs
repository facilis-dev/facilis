#!/usr/bin/env node
// Typechecks the patches a probe run produced (scripts/dev/ai-probe.mjs), by applying
// them to a scratch copy of examples/todo-app and running the project's own tsc.
//
// The 16-rule validator is structural; it cannot know that a generated route imports
// defineAuthorizedHandler from the wrong package or calls it with the wrong shape. This
// step is what answers "would the generated project still build?".
//
// Usage: node --experimental-strip-types scripts/dev/ai-probe-check.mjs <results.json>

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const EXAMPLE = join(REPO, "examples/todo-app");
const TSC = join(EXAMPLE, "node_modules", ".bin", "tsc");
// Inside the example tree on purpose: tsc resolves the project's deps from the enclosing
// node_modules and @types/node from the repo root. A /tmp copy resolves neither.
const OUT = join(EXAMPLE, ".ai-eval");
const SKIP = new Set(["node_modules", ".output", ".turbo", ".git", ".ai-eval"]);

function unwrap(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
}

function patchesOf(result) {
  if (typeof result.raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(unwrap(result.raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.patches)) return null;
  return parsed.patches.filter(
    (patch) => typeof patch === "object" && patch !== null && typeof patch.path === "string",
  );
}

/** cpSync refuses to copy a directory into its own subdirectory, so copy entry by entry. */
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

function prepare(label) {
  const directory = join(OUT, label);
  rmSync(directory, { recursive: true, force: true });
  copyTree(EXAMPLE, directory);
  // The copy lives outside the repo, so the repo-relative \`extends\` must become absolute.
  const tsconfigPath = join(directory, "tsconfig.json");
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  tsconfig.extends = join(REPO, "tsconfig.base.json");
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
  return directory;
}

function apply(directory, patches) {
  const written = [];
  for (const patch of patches) {
    const target = join(directory, patch.path);
    if (patch.action === "delete") {
      rmSync(target, { force: true });
      written.push("delete " + patch.path);
      continue;
    }
    if (typeof patch.content !== "string") continue;
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, patch.content);
    written.push(patch.action + " " + patch.path);
  }
  return written;
}

function typecheck(directory) {
  const result = spawnSync(TSC, ["-p", "tsconfig.json", "--noEmit"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = (result.stdout || "") + (result.stderr || "");
  const errors = output
    .split("\n")
    .filter((line) => /error TS\d+/.test(line))
    .map((line) => line.replace(directory + "/", "").trim());
  return {
    ok: result.status === 0,
    status: result.status,
    errors: errors.slice(0, 12),
    total: errors.length,
  };
}

function labelOf(result) {
  return (result.config + "-" + result.task).replace(/[^a-z0-9-]/gi, "_");
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: ai-probe-check.mjs <results.json>");
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const results = payload.results.filter((result) => result.raw !== undefined);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  console.log("checking " + results.length + " patch sets; scratch " + OUT);
  const rows = [];
  try {
    for (const result of results) {
      const patches = patchesOf(result);
      if (patches === null) {
        rows.push({
          ...result,
          typecheck: { ok: false, status: null, errors: ["no parseable patches"], total: 0 },
        });
        continue;
      }
      const directory = prepare(labelOf(result));
      const written = apply(directory, patches);
      const tsc = typecheck(directory);
      rows.push({
        config: result.config,
        task: result.task,
        patches: written.length,
        typecheck: tsc,
      });
      console.log(
        "[" +
          (tsc.ok ? "TSC ok  " : "TSC FAIL") +
          "] " +
          result.config +
          " " +
          result.task +
          " " +
          written.length +
          " files" +
          (tsc.ok ? "" : " -> " + (tsc.errors[0] ?? "unknown")),
      );
    }
  } finally {
    rmSync(OUT, { recursive: true, force: true });
  }
  const lines = ["# Typecheck of probe patches", ""];
  lines.push("| config | task | files | typecheck | first error |");
  lines.push("|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      "| " +
        row.config +
        " | " +
        row.task +
        " | " +
        row.patches +
        " | " +
        (row.typecheck.ok ? "ok" : "FAIL " + row.typecheck.total) +
        " | " +
        (row.typecheck.errors[0] ?? "").replace(/\|/g, "\\|").slice(0, 180) +
        " |",
    );
  }
  const perConfig = {};
  for (const row of rows) {
    const entry = (perConfig[row.config] ??= { total: 0, ok: 0 });
    entry.total += 1;
    if (row.typecheck.ok) entry.ok += 1;
  }
  lines.push("", "## Per config", "");
  for (const [config, entry] of Object.entries(perConfig)) {
    lines.push("- " + config + ": " + entry.ok + "/" + entry.total + " typecheck clean");
  }
  const summary = lines.join("\n") + "\n";
  const outDir = dirname(file);
  writeFileSync(join(outDir, "typecheck.json"), JSON.stringify(rows, null, 2));
  writeFileSync(join(outDir, "typecheck.md"), summary);
  console.log("\n" + summary);
}

main();
