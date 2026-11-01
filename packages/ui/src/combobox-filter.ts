export type FilterableOption = {
  value: string;
  label: string;
  hint?: string;
};

/**
 * Case-insensitive autocomplete: matches the label first, then the value, on a trimmed query.
 * An empty query keeps every option in source order.
 */
export function filterOptions<T extends FilterableOption>(
  options: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
  );
}

/** Wraps the active index across a list; -1 (nothing active) moves to the first/last entry. */
export function moveIndex(current: number, step: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return step > 0 ? 0 : length - 1;
  return (current + step + length) % length;
}
