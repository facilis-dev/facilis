/**
 * Joins the class names a component contributes, dropping falsy entries.
 *
 * Kept internal (not re-exported from src/index.ts): .fc-* class names are an implementation
 * detail of theme.css, not part of the public API.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
