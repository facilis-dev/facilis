/**
 * The offending source line, capped, for a finding that names one.
 *
 * Shared by rule 1 (`ts-parse`) and the structural `json-parse` check, so the two read the
 * same in the IDE's findings list and in the model's feedback.
 */

const LIMIT = 160;

export function excerptOf(content: string, line: number | undefined): string | undefined {
  if (line === undefined) return undefined;
  const text = content.split("\n")[line - 1];
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed.length > LIMIT ? trimmed.slice(0, LIMIT) + "…" : trimmed;
}
