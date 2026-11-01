/**
 * Renders an unexpected value for an error message.
 *
 * typeof alone says "object" for null and arrays, which is exactly the confusion the TypeError
 * messages exist to clear up.
 */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
