#!/usr/bin/env node
// Repository-owned labels, applied with `gh` (D-194).
//
//   pnpm labels:sync             # create or update every label below
//   pnpm labels:sync -- --dry-run
//
// `--force` makes the command idempotent: an existing label is updated to this definition,
// so this file is the single source of truth. GitHub's default labels (bug, enhancement,
// documentation, ...) are not managed here; the issue forms use them as they are.

import { spawnSync } from "node:child_process";
import process from "node:process";

const LABELS = [
  {
    name: "task",
    color: "1d76db",
    description: "Internal work: refactor, docs, tooling or CI.",
  },
  {
    name: "agent:ready",
    color: "0e8a16",
    description: "Fully specified and ready for an AI agent to implement.",
  },
];

const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const dryRun = argv.includes("--dry-run");
const unknown = argv.filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  console.error(`unknown option "${unknown[0]}" (usage: labels:sync [--dry-run])`);
  process.exit(1);
}

for (const label of LABELS) {
  const args = [
    "label",
    "create",
    label.name,
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
  ];
  if (dryRun) {
    const printable = args.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg));
    console.log(`gh ${printable.join(" ")}`);
    continue;
  }
  const result = spawnSync("gh", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`could not run gh: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
