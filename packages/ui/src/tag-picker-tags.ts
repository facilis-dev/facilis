/**
 * Normalisation for the TagPicker: tags are trimmed, compared case-insensitively, and
 * suggestions hide options that are already chips.
 */

export function normalizeTag(raw: string): string {
  return raw.trim();
}

export function isDuplicateTag(tags: readonly string[], candidate: string): boolean {
  const needle = normalizeTag(candidate).toLowerCase();
  if (needle === "") return false;
  return tags.some((tag) => normalizeTag(tag).toLowerCase() === needle);
}

/**
 * Options that are not already selected and match the query, in source order, capped to limit.
 * An empty query returns the first available suggestions.
 */
export function filterTagSuggestions(
  options: readonly string[],
  selected: readonly string[],
  query: string,
  limit = 5,
): string[] {
  const needle = normalizeTag(query).toLowerCase();
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const option of options) {
    const tag = normalizeTag(option);
    if (tag === "") continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isDuplicateTag(selected, tag)) continue;
    if (needle !== "" && !key.includes(needle)) continue;
    suggestions.push(tag);
    if (suggestions.length >= limit) break;
  }

  return suggestions;
}
