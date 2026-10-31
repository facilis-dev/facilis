// Line diff for the reviewable proposal (D-045; types.ts FileDiff).
//
// The UI shows one unified diff per proposed file before anything is written, so this
// module has to be cheap and total: create/delete are trivial, modify uses LCS over
// lines, and both the DP and the rendered output are capped so a pathological file can
// never freeze the chat. No React, no i18n.

import type { DiffLine, FileDiff } from "./types";

const CONTEXT_LINES = 3;
const MAX_RENDERED_LINES = 400;
// Beyond ~1M cells the LCS table is memory a browser tab should not spend on a preview;
// a whole-file replacement is less useful but honest, and it is flagged as truncated.
const MAX_DP_CELLS = 1_000_000;

type OpKind = "eq" | "add" | "del";

interface Op {
  kind: OpKind;
  text: string;
}

/** Split on newlines without inventing a trailing empty line for a final newline. */
function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function emptyDiff(): FileDiff {
  return { lines: [], added: 0, removed: 0, truncated: false };
}

/** A created or deleted file: no hunk header, just one rendered line per source line. */
function renderWholeFile(kind: "add" | "del", lines: readonly string[]): FileDiff {
  const rendered: DiffLine[] = [];
  let truncated = false;
  for (const text of lines) {
    if (rendered.length >= MAX_RENDERED_LINES) {
      truncated = true;
      break;
    }
    rendered.push({ kind, text });
  }
  return {
    lines: rendered,
    added: kind === "add" ? lines.length : 0,
    removed: kind === "del" ? lines.length : 0,
    truncated,
  };
}

function diffOps(before: readonly string[], after: readonly string[]): Op[] {
  const columns = after.length + 1;
  // The table stores the LCS length of the suffixes starting at each cell, so a
  // forward walk can emit the edits greedily.
  const table = new Uint32Array((before.length + 1) * columns);
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row * columns + column] =
        before[row] === after[column]
          ? table[(row + 1) * columns + column + 1] + 1
          : Math.max(table[(row + 1) * columns + column], table[row * columns + column + 1]);
    }
  }

  const ops: Op[] = [];
  let row = 0;
  let column = 0;
  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      ops.push({ kind: "eq", text: before[row] });
      row += 1;
      column += 1;
    } else if (table[(row + 1) * columns + column] >= table[row * columns + column + 1]) {
      ops.push({ kind: "del", text: before[row] });
      row += 1;
    } else {
      ops.push({ kind: "add", text: after[column] });
      column += 1;
    }
  }
  while (row < before.length) {
    ops.push({ kind: "del", text: before[row] });
    row += 1;
  }
  while (column < after.length) {
    ops.push({ kind: "add", text: after[column] });
    column += 1;
  }
  return ops;
}

interface Hunk {
  start: number;
  end: number;
}

/** Change runs closer than 2*context merge into one hunk; the rest get their own. */
function hunkRanges(ops: readonly Op[]): Hunk[] {
  const changes: number[] = [];
  ops.forEach((op, index) => {
    if (op.kind !== "eq") changes.push(index);
  });
  if (changes.length === 0) return [];

  const ranges: Hunk[] = [];
  let start = Math.max(0, changes[0] - CONTEXT_LINES);
  let last = changes[0];
  for (const index of changes.slice(1)) {
    if (index - last - 1 <= CONTEXT_LINES * 2) {
      last = index;
      continue;
    }
    ranges.push({ start, end: Math.min(ops.length, last + CONTEXT_LINES + 1) });
    start = Math.max(0, index - CONTEXT_LINES);
    last = index;
  }
  ranges.push({ start, end: Math.min(ops.length, last + CONTEXT_LINES + 1) });
  return ranges;
}

function renderUnified(ops: readonly Op[]): { lines: DiffLine[]; truncated: boolean } {
  // beforeAt[k] / afterAt[k] are the 1-based line numbers *at* op index k; the hunk
  // header needs the numbers of its first rendered line and the count in its range.
  const beforeAt = new Uint32Array(ops.length + 1);
  const afterAt = new Uint32Array(ops.length + 1);
  beforeAt[0] = 1;
  afterAt[0] = 1;
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    beforeAt[index + 1] = beforeAt[index] + (op.kind === "add" ? 0 : 1);
    afterAt[index + 1] = afterAt[index] + (op.kind === "del" ? 0 : 1);
  }

  const lines: DiffLine[] = [];
  let truncated = false;
  const push = (line: DiffLine): boolean => {
    if (lines.length >= MAX_RENDERED_LINES) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  for (const range of hunkRanges(ops)) {
    const beforeCount = beforeAt[range.end] - beforeAt[range.start];
    const afterCount = afterAt[range.end] - afterAt[range.start];
    // Unified-diff convention: an empty side starts at line 0, not line 1.
    const beforeStart = beforeCount === 0 ? beforeAt[range.start] - 1 : beforeAt[range.start];
    const afterStart = afterCount === 0 ? afterAt[range.start] - 1 : afterAt[range.start];
    const header = `@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`;
    if (!push({ kind: "hunk", text: header })) break;

    let capped = false;
    for (let index = range.start; index < range.end; index += 1) {
      const op = ops[index];
      const kind: DiffLine["kind"] = op.kind === "eq" ? "ctx" : op.kind;
      if (!push({ kind, text: op.text })) {
        capped = true;
        break;
      }
    }
    if (capped) break;
  }

  return { lines, truncated };
}

/**
 * Last resort for a modify whose LCS table would be too large: every old line removed
 * and every new line added. Less precise, but linear, and never shown as a real diff.
 */
function wholeFileReplacement(before: readonly string[], after: readonly string[]): FileDiff {
  const lines: DiffLine[] = [];
  const add = (line: DiffLine): void => {
    if (lines.length < MAX_RENDERED_LINES) lines.push(line);
  };
  add({ kind: "hunk", text: `@@ -1,${before.length} +1,${after.length} @@` });
  for (const text of before) add({ kind: "del", text });
  for (const text of after) add({ kind: "add", text });
  return { lines, added: after.length, removed: before.length, truncated: true };
}

export function fileDiff(before: string | null, after: string | null): FileDiff {
  if (before === null) {
    if (after === null) return emptyDiff();
    return renderWholeFile("add", splitLines(after));
  }
  if (after === null) return renderWholeFile("del", splitLines(before));

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  if (sameLines(beforeLines, afterLines)) return emptyDiff();
  if (beforeLines.length === 0) return renderWholeFile("add", afterLines);
  if (afterLines.length === 0) return renderWholeFile("del", beforeLines);
  if (beforeLines.length * afterLines.length > MAX_DP_CELLS) {
    return wholeFileReplacement(beforeLines, afterLines);
  }

  const ops = diffOps(beforeLines, afterLines);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added += 1;
    else if (op.kind === "del") removed += 1;
  }
  return { ...renderUnified(ops), added, removed };
}
