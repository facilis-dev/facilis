// Route-template parameter names for the project graph's route cards. A route path reaches
// the view model in two conventions: as the analyzer's URL template (`/api/todos/{id}`) and,
// for hand-built graphs, as the Nitro file-router fragment (`/api/todos/[id]`). Both name the
// same parameter, so the card can show one list. Pure: no IO, no React.
//
// Deliberately segment-based: a parameter is always a whole path segment here, so a source
// file name such as `[id].patch.ts` is not mistaken for a route parameter.

/** `{id}`, `{id?}` (optional), `{...slug}` / `{slug*}` (catch-all). */
const BRACE_SEGMENT = /^\{([^{}]+)\}$/;
/** `[id]`, `[[id]]` (optional), `[...slug]`, `[[...slug]]` (optional catch-all). */
const BRACKET_SEGMENT = /^\[\[?(?:\.\.\.)?([^[\]]+)\]?\]$/;

/** Strip the optional/catch-all markers; they are routing syntax, not part of the name. */
function parameterName(raw: string): string {
  let name = raw;
  if (name.startsWith("...")) name = name.slice(3);
  if (name.endsWith("?") || name.endsWith("*")) name = name.slice(0, -1);
  return name;
}

/**
 * The parameter names a route template declares, in path order and without duplicates.
 * A path with no template parameters (`/api/todos`) yields an empty list.
 */
export function pathParamsOf(path: string): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const segment of path.split("/")) {
    const match = BRACE_SEGMENT.exec(segment) ?? BRACKET_SEGMENT.exec(segment);
    if (match === null) continue;
    const name = parameterName(match[1] ?? "");
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
