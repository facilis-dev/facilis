import type { SourceRef } from "./types.ts";

/**
 * Line positions of one source text, built once per file.
 *
 * The analyzer reads a source position for every import/export/usage node it records, and
 * the original helper rescanned the text from offset 0 for each of them. With ~1200 files
 * (the project plus the framework sources it imports) that quadratic scan was the single
 * biggest cost of the in-VM dev-server startup: 27 s of a 38.5 s Vite boot (issue #36).
 * A binary search over the newline offsets makes each lookup O(log lines).
 */
export interface SourceLines {
  /** 1-based line number of a source offset (clamped to the text). */
  lineAt(offset: number): number;
}

/** Empty text: every offset is line 1 (used when a file is not in the module graph). */
export const NO_SOURCE_LINES: SourceLines = { lineAt: () => 1 };

/** Index one source text; the one O(n) pass the callers pay per file, not per node. */
export function sourceLines(source: string): SourceLines {
  const starts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return {
    lineAt(offset: number): number {
      const target = Math.min(Math.max(offset, 0), source.length);
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        // `middle` is always in range; the guard is for noUncheckedIndexedAccess.
        const start = starts[middle];
        if (start !== undefined && start <= target) low = middle;
        else high = middle - 1;
      }
      return low + 1;
    },
  };
}

/** A source reference from an indexed file; the hot path of every pass. */
export function sourceRef(file: string, lines: SourceLines, offset: number): SourceRef {
  return { file, line: lines.lineAt(offset) };
}

/**
 * One-off line lookup for a text without an index (a parser adapter reporting its first
 * error). Passes over parsed files use `sourceLines`/`sourceRef` instead.
 */
export function lineOf(source: string, offset: number): number {
  return sourceLines(source).lineAt(offset);
}
