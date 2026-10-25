const STATEMENT_BREAKPOINT = /-->\s*statement-breakpoint\s*/i;

/**
 * Split a migration file into executable statements.
 *
 * drizzle-kit emits `--> statement-breakpoint` between statements; plain SQL files
 * fall back to end-of-line semicolons. Splitting is intentionally conservative: a
 * statement is never rewritten, only separated.
 */
export function splitSqlStatements(source: string): string[] {
  const normalized = source.replace(/\r\n/g, "\n");
  const chunks = normalized.includes("--> statement-breakpoint")
    ? normalized.split(STATEMENT_BREAKPOINT)
    : normalized.split(/;\s*(?:\n|$)/);
  return chunks.map((chunk) => chunk.trim()).filter(isExecutable);
}

function isExecutable(statement: string): boolean {
  if (statement.length === 0) return false;
  return statement.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("--");
  });
}
