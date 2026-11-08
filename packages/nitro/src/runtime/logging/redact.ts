/**
 * Redaction and caps for logger-provided data (D-119).
 *
 * `data`/`details` is the only arbitrary payload a route can hand the pipeline, so it is the
 * one place a secret could leak. Keys are matched case-insensitively against the names a
 * credential commonly travels under; values are additionally capped so one huge or deeply
 * nested object cannot blow up a JSONL line. Headers and bodies are never passed in here in
 * the first place: the pipeline logs shapes, not requests.
 */

export const REDACTED = "[redacted]";
export const CIRCULAR = "[circular]";
export const MAX_DEPTH_PLACEHOLDER = "[max-depth]";
export const UNSERIALIZABLE = "[unserializable]";

export const MAX_REDACT_DEPTH = 6;
export const MAX_REDACT_ARRAY = 50;
export const MAX_REDACT_STRING = 1000;

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|cookie|authorization|set-cookie|api[-_]?key|credential|samlresponse|samlrequest|assertion|email|sessionid/i;

/** True when a key names something that must never reach the sink in clear text. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Truncates a string to `max` characters; never appends a marker (it would exceed the cap). */
export function capString(value: string, max: number = MAX_REDACT_STRING): string {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Recursively redacts and caps an arbitrary value.
 *
 * Accepted output types are the JSON ones (plus stringified bigints and ISO dates); anything
 * else is replaced with a placeholder rather than serialized by an arbitrary method. Cycles
 * become `[circular]`, cycles are detected along the current path only, so a shared value is
 * emitted twice instead of being mistaken for a cycle.
 */
export function redactUnknown(value: unknown): unknown {
  return redact(value, 0, new WeakSet<object>());
}

/** Redacts a `data`/`details` record; returns undefined when the value is not a plain object. */
export function redactRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const redacted = redactUnknown(value);
  return isPlainObject(redacted) ? redacted : undefined;
}

function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return capString(value);
  if (typeof value === "bigint") return value.toString();
  if (value === undefined || typeof value === "symbol" || typeof value === "function") {
    return undefined;
  }
  if (typeof value !== "object") return UNSERIALIZABLE;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return CIRCULAR;
  if (depth >= MAX_REDACT_DEPTH) return MAX_DEPTH_PLACEHOLDER;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_REDACT_ARRAY).map((item) => redact(item, depth + 1, seen));
    }
    if (value instanceof Error) {
      return {
        name: capString(value.name),
        message: capString(value.message),
        ...(value.stack === undefined ? {} : { stack: capString(value.stack) }),
      };
    }
    if (value instanceof Map) {
      const entries = Array.from(value, ([key, item]) => [String(key), item] as const);
      return redact(Object.fromEntries(entries), depth + 1, seen);
    }
    if (value instanceof Set) {
      return redact([...value], depth + 1, seen);
    }
    if (!isPlainObject(value)) return UNSERIALIZABLE;

    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        redacted[key] = REDACTED;
        continue;
      }
      const next = redact(item, depth + 1, seen);
      // `undefined` is dropped: JSON.stringify would drop it too, and keeping it would make
      // the output shape depend on the serializer.
      if (next !== undefined) redacted[key] = next;
    }
    return redacted;
  } finally {
    seen.delete(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
