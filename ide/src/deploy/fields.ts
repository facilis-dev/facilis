// The field primitives the deployment config's checks are built from (D-064).
//
// Hand-written on purpose: a deployment build validates one JSON document, and a schema
// library would put a runtime dependency into the IDE bundle for no extra check. Every
// helper records an issue instead of throwing, so one build reports every mistake at once.

export type Obj = Record<string, unknown>;

export function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkKeys(
  obj: Obj,
  allowed: readonly string[],
  at: string,
  issues: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(at + "." + key + ": unknown key");
  }
}

export function fieldObject(obj: Obj, key: string, at: string, issues: string[]): Obj | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    issues.push(at + "." + key + ": expected an object");
    return undefined;
  }
  return value;
}

export function fieldString(
  obj: Obj,
  key: string,
  at: string,
  issues: string[],
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.push(at + "." + key + ": expected a string");
    return undefined;
  }
  return value;
}

export function fieldBoolean(
  obj: Obj,
  key: string,
  at: string,
  issues: string[],
): boolean | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push(at + "." + key + ": expected a boolean");
    return undefined;
  }
  return value;
}

export function fieldEnum<T extends string>(
  obj: Obj,
  key: string,
  at: string,
  allowed: readonly T[],
  issues: string[],
): T | undefined {
  const value = fieldString(obj, key, at, issues);
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    issues.push(at + "." + key + ": expected one of " + allowed.join(", "));
    return undefined;
  }
  return value as T;
}

export function fieldStringArray(
  obj: Obj,
  key: string,
  at: string,
  issues: string[],
): string[] | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    issues.push(at + "." + key + ": expected an array of non-empty strings");
    return undefined;
  }
  return value as string[];
}

/** A head-sampling ratio: 0 drops everything, 1 keeps every trace (D-203). */
export function fieldRatio(
  obj: Obj,
  key: string,
  at: string,
  issues: string[],
): number | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    issues.push(at + "." + key + ": expected a number between 0 and 1");
    return undefined;
  }
  return value;
}

/**
 * An exact origin — scheme, host and port, nothing else. A path, a query or credentials
 * cannot be compared to the origin a browser sends, and a wildcard would make the
 * ingestion allowlist meaningless (D-203, spec §8.8).
 */
export function fieldOrigins(
  obj: Obj,
  key: string,
  at: string,
  issues: string[],
): string[] | undefined {
  const values = fieldStringArray(obj, key, at, issues);
  if (values === undefined) return undefined;
  for (const value of values) {
    const url = parseUrl(value);
    if (
      url === null ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      issues.push(at + "." + key + ": expected an exact origin (scheme://host[:port])");
    }
  }
  return values;
}

/** An absolute http(s) URL is the only shape a registry, an endpoint or a gateway may take. */
export function fieldUrl(obj: Obj, key: string, at: string, issues: string[]): string | undefined {
  const value = fieldString(obj, key, at, issues);
  if (value === undefined) return undefined;
  const url = parseUrl(value);
  if (url === null) issues.push(at + "." + key + ": expected an absolute http(s) URL");
  return url === null ? undefined : value;
}

export function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
