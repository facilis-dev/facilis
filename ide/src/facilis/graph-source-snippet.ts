// The inspector's source preview: a small window of lines around a SourceRef.
//
// Pure so the clamping is unit-testable without a controller: a fact can point past the end
// of the file the VFS still has (an analysis from before an edit), or at a framework stub the
// preview cannot read at all, and neither may throw or render a broken gutter.

/** One window of source lines, both bounds 1-based and inclusive. */
export interface SourceSnippet {
  readonly from: number;
  readonly to: number;
  readonly lines: readonly string[];
}

/** A single trailing newline is a terminator, not an extra empty line in the gutter. */
const TRAILING_NEWLINE = /\r?\n$/;

/**
 * The lines around `line` (1-based), `context` lines on each side, clamped to the file.
 * Returns null for empty text; an out-of-range line is clamped to the nearest real line.
 */
export function snippetAround(text: string, line: number, context: number): SourceSnippet | null {
  if (text.length === 0) return null;
  const rows = sourceLines(text);
  const requestedSpan = Number.isFinite(context) ? Math.trunc(context) : 0;
  const span = Math.max(0, requestedSpan);
  const requestedLine = Number.isFinite(line) ? Math.trunc(line) : 1;
  const anchor = Math.min(Math.max(1, requestedLine), rows.length);
  const from = Math.max(1, anchor - span);
  const to = Math.min(rows.length, anchor + span);
  return { from, to, lines: rows.slice(from - 1, to) };
}

function sourceLines(text: string): string[] {
  return text.replace(TRAILING_NEWLINE, "").split(/\r?\n/);
}

/**
 * The declaration line of a component in its defining file, for the preview's "open the
 * component" jump. The analyzer resolves the file but only keeps the JSX usage line, so the
 * definition is found by looking for the exported declaration; an unknown shape falls back to
 * the top of the file rather than guessing a line.
 */
export function declarationLineOf(text: string | undefined, name: string): number {
  if (text === undefined || text.length === 0) return 1;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A JS identifier char after the name means a longer identifier (`Row` vs `RowItem`);
  // `$\b` alone would miss a name ending in a non-word character.
  const declaration = new RegExp(
    "(?:function|const|let|var|class)\\s+" + escaped + "(?![A-Za-z0-9_$])",
  );
  const rows = sourceLines(text);
  for (let index = 0; index < rows.length; index += 1) {
    if (declaration.test(rows[index] ?? "")) return index + 1;
  }
  return 1;
}
