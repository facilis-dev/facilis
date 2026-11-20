#!/usr/bin/env node
/**
 * One file per decision: `docs/decisions/D-0NN-<slug>.md`.
 *
 * The log used to be a single file that every branch appended to, which made it the one file that
 * conflicted on every pair of pull requests — and let two branches take the same number (D-197
 * did). Splitting it removes the conflict; this gate keeps the numbering and the generated index
 * honest, because a duplicate number is a silent ambiguity, not a merge error.
 *
 * Usage:
 *   node scripts/check-decisions.mjs           validate the files and the index
 *   node scripts/check-decisions.mjs --write   regenerate docs/decisions/README.md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Directory holding one file per decision, relative to the repository root. */
export const DECISIONS_DIR = "docs/decisions";
/** Generated index of that directory. */
export const INDEX_NAME = "README.md";
/**
 * Numbers that were never written, so the check may see them missing: D-104 was skipped, and
 * D-109 is the entry `docs/MIGRATION-PLAN.md` already records as missing. Both predate the split.
 */
export const ALLOWED_GAPS = new Set([104, 109]);

const FILE_PATTERN = /^(D-(\d{3}))-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const HEADING_PATTERN = /^# (D-\d{3}) — (.+)$/;
const STATUS_PATTERN = /^\*\*Status:\*\* ([a-z]+)\b(.*)$/;
const DATE_PATTERN = /\((\d{4}-\d{2}-\d{2})/;
const DATE_WITHOUT_PARENS_PATTERN = /(\d{4}-\d{2}-\d{2})/;
const STATUSES = new Set(["accepted", "superseded", "open", "resolved", "root"]);
const SLUG_LIMIT = 70;

/** kebab-case of a decision title: the suffix of its file name. */
export function slugify(title) {
  const kebab = title
    .toLowerCase()
    .replace(/[`*_"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (kebab.length <= SLUG_LIMIT) return kebab || "decision";
  const head = kebab.slice(0, SLUG_LIMIT);
  const boundary = head.lastIndexOf("-");
  return (boundary > 0 ? head.slice(0, boundary) : head).replace(/-+$/, "");
}

function firstStatus(lines) {
  for (const line of lines.slice(1, 5)) {
    const match = STATUS_PATTERN.exec(line);
    if (match) return { status: match[1], rest: match[2] };
  }
  return null;
}

function parseDecision(file, text, errors) {
  const match = FILE_PATTERN.exec(file);
  if (!match) {
    errors.push(`${file}: the name must be D-0NN-<slug>.md`);
    return null;
  }
  const [, id, digits, slug] = match;
  const lines = text.split("\n");
  const heading = HEADING_PATTERN.exec(lines[0] ?? "");
  if (!heading) {
    errors.push(`${file}: the first line must be "# D-0NN — title"`);
    return null;
  }
  if (heading[1] !== id)
    errors.push(`${file}: the heading says ${heading[1]}, the name says ${id}`);
  const title = heading[2].trim();
  if (slugify(title) !== slug) errors.push(`${file}: the slug of "${title}" is ${slugify(title)}`);
  const status = firstStatus(lines);
  if (!status) {
    errors.push(`${file}: no "**Status:** …" line in the first five lines`);
    return null;
  }
  if (!STATUSES.has(status.status)) {
    errors.push(
      `${file}: unknown status "${status.status}" (accepted, superseded, open, resolved, root)`,
    );
  }
  const dated = DATE_PATTERN.exec(status.rest) ?? DATE_WITHOUT_PARENS_PATTERN.exec(status.rest);
  return {
    id,
    number: Number(digits),
    title,
    slug,
    status: status.status,
    date: dated?.[1] ?? null,
    file,
  };
}

/** Every decision file in `dir`, plus the problems found while reading them. */
export function collectDecisions(dir) {
  const errors = [];
  const names = readdirSync(dir)
    .filter((name) => name !== INDEX_NAME && !name.startsWith("."))
    .toSorted();
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".md")) {
      errors.push(
        `${name}: only decision files and the generated ${INDEX_NAME} live in ${DECISIONS_DIR}`,
      );
      continue;
    }
    const parsed = parseDecision(name, readFileSync(join(dir, name), "utf8"), errors);
    if (parsed) entries.push(parsed);
  }
  const ordered = entries.toSorted((a, b) => a.number - b.number);
  return { entries: ordered, errors };
}

/** Problems with the numbering itself: a duplicate is an ambiguity, a gap is only reported if unlisted. */
export function validateNumbering(entries) {
  const errors = [];
  const seen = new Map();
  for (const entry of entries) {
    const other = seen.get(entry.number);
    if (other) {
      errors.push(`${entry.id} is used twice: ${other.file} and ${entry.file}`);
      continue;
    }
    seen.set(entry.number, entry);
  }
  let expected = 1;
  for (const number of [...seen.keys()].toSorted((a, b) => a - b)) {
    if (number > expected && !ALLOWED_GAPS.has(expected)) {
      const from = `D-${String(expected).padStart(3, "0")}`;
      errors.push(`${from} is missing (numbers run ${expected}→${number} with a hole)`);
    }
    expected = number + 1;
  }
  return errors;
}

function cell(value) {
  return value.replace(/\|/g, "\\|");
}

/** The generated index: a table of every decision, oldest first. */
export function renderIndex(entries) {
  const rows = entries.map(
    (entry) =>
      `| [${entry.id}](./${entry.file}) | ${cell(entry.title)} | ${entry.status} | ${entry.date ?? "—"} |`,
  );
  return [
    "<!-- Generated by `node scripts/check-decisions.mjs --write`: edit the decision files, not this table. -->",
    "",
    "# Decision index",
    "",
    `${entries.length} decisions, one file each (` +
      "`D-0NN-<slug>.md`" +
      `). The reading guide and the`,
    "open items are in [`../DECISIONS.md`](../DECISIONS.md); a `D-0NN` reference anywhere resolves to",
    "the file whose name starts with that ID.",
    "",
    "| ID | Decision | Status | Date |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/** Check the directory, or write its index. Returns the process exit code. */
export function main(argv = [], cwd = process.cwd()) {
  const dir = resolve(cwd, DECISIONS_DIR);
  const write = argv.includes("--write");
  const { entries, errors } = collectDecisions(dir);
  errors.push(...validateNumbering(entries));
  if (errors.length) return report(errors);
  if (write) {
    writeFileSync(join(dir, INDEX_NAME), renderIndex(entries));
    console.log(`decisions: wrote ${INDEX_NAME} for ${entries.length} decision(s)`);
    return 0;
  }
  const indexed = join(dir, INDEX_NAME);
  let current = null;
  try {
    current = readFileSync(indexed, "utf8");
  } catch {
    errors.push(`${DECISIONS_DIR}/${INDEX_NAME} is missing: run pnpm decisions:index`);
  }
  if (current !== null && current !== renderIndex(entries)) {
    errors.push(`${DECISIONS_DIR}/${INDEX_NAME} is stale: run pnpm decisions:index`);
  }
  if (errors.length) return report(errors);
  console.log(`decisions: ok (${entries.length} decision(s), index in sync)`);
  return 0;
}

function report(errors) {
  for (const error of errors) console.error(`✗ ${error}`);
  console.error(`${errors.length} problem(s) in ${DECISIONS_DIR}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
