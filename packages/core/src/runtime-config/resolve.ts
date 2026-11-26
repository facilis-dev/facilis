import { SecretString } from "./secret-string.ts";
import {
  isSecretMarker,
  type FacilisPublicConfig,
  type FacilisRuntimeConfig,
  type FacilisRuntimeDeclaration,
  type FacilisRuntimeDeclarations,
  type FacilisRuntimeValue,
  type JsonValue,
} from "./schema.ts";

/**
 * One resolution pass (D-224): the app's declarations, overridden by the process environment.
 *
 * The first declared layer is the artifact's value, so a deployment that sets nothing keeps
 * working; the environment is the operator's. No framework default is merged here — the canonical
 * values in `defaults.ts` exist for the generator and the error messages only.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export const ENV_PREFIX = "FACILIS_";
export const PUBLIC_ENV_PREFIX = "FACILIS_PUBLIC_";
/** Build-only switches: a runtime boot ignores them instead of failing (D-224). */
export const BUILD_ONLY_ENV = ["FACILIS_DEV_METRICS", "FACILIS_TELEMETRY_FE"] as const;

export type RuntimeConfigProblemCode = "unknown-env" | "invalid-env" | "empty-secret";

export interface RuntimeConfigProblem {
  readonly code: RuntimeConfigProblemCode;
  /** The variable as the operator wrote it. */
  readonly envName: string;
  /** The declared key, when the variable maps to one. */
  readonly key: string | null;
  readonly message: string;
}

/** `logMaxBytes` -> `FACILIS_LOG_MAX_BYTES`; one flat key is one variable. */
export function envNameFor(key: string, prefix: string = ENV_PREFIX): string {
  return prefix + key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

export function resolveRuntimeConfig(input: {
  readonly runtime?: FacilisRuntimeDeclarations;
  readonly env?: EnvLike;
}): { readonly runtime: FacilisRuntimeConfig; readonly problems: readonly RuntimeConfigProblem[] } {
  const env = input.env ?? {};
  const declared = input.runtime ?? {};
  const runtime: Record<string, FacilisRuntimeValue> = {};
  const problems: RuntimeConfigProblem[] = [];
  const expectedNames = new Set<string>();

  for (const [key, declaration] of Object.entries(declared)) {
    const envName = envNameFor(key);
    expectedNames.add(envName);
    const raw = env[envName];
    if (isSecretMarker(declaration)) {
      if (raw === undefined) runtime[key] = null;
      else if (raw.trim() === "") problems.push(problem("empty-secret", envName, key, "exported empty; omit it or set a value"));
      else runtime[key] = new SecretString(raw);
      continue;
    }
    if (raw === undefined) {
      runtime[key] = declaration;
      continue;
    }
    const parsed = parseEnvValue(raw, declaration);
    if (parsed.ok) runtime[key] = parsed.value;
    else problems.push(problem("invalid-env", envName, key, parsed.expected));
  }

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith(ENV_PREFIX)) continue;
    if (name.startsWith(PUBLIC_ENV_PREFIX) || isBuildOnly(name) || expectedNames.has(name)) continue;
    const suggestion = suggest(name, expectedNames);
    problems.push(
      problem(
        "unknown-env",
        name,
        null,
        suggestion === null ? "no runtime key maps to it" : `unknown variable, did you mean ${suggestion}?`,
      ),
    );
  }

  return { runtime: Object.freeze(runtime), problems: Object.freeze(problems) };
}

/** Build-time companion: `FACILIS_PUBLIC_<KEY>` overrides the declared value, and only then. */
export function resolvePublicConfig(input: {
  readonly public?: FacilisPublicConfig;
  readonly env?: EnvLike;
}): { readonly public: FacilisPublicConfig; readonly problems: readonly RuntimeConfigProblem[] } {
  const env = input.env ?? {};
  const declared = input.public ?? {};
  const resolved: Record<string, JsonValue> = {};
  const problems: RuntimeConfigProblem[] = [];
  const expectedNames = new Set<string>();

  for (const [key, declaration] of Object.entries(declared)) {
    const envName = envNameFor(key, PUBLIC_ENV_PREFIX);
    expectedNames.add(envName);
    const raw = env[envName];
    if (raw === undefined) {
      resolved[key] = declaration;
      continue;
    }
    const parsed = parseEnvValue(raw, declaration);
    if (parsed.ok) resolved[key] = parsed.value;
    else problems.push(problem("invalid-env", envName, key, parsed.expected));
  }

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith(PUBLIC_ENV_PREFIX) || expectedNames.has(name)) continue;
    const suggestion = suggest(name, expectedNames);
    problems.push(
      problem(
        "unknown-env",
        name,
        null,
        suggestion === null ? "no public key maps to it" : `unknown variable, did you mean ${suggestion}?`,
      ),
    );
  }

  return { public: Object.freeze(resolved), problems: Object.freeze(problems) };
}

export function formatRuntimeProblems(problems: readonly RuntimeConfigProblem[]): string {
  return ["FATAL runtime env", ...problems.map((entry) => `  ${entry.envName}  ${entry.message}`)].join("\n");
}

/** Contract violations stop the boot; a subsystem refusal (D-053/D-068) does not come through here. */
export function assertNoRuntimeProblems(problems: readonly RuntimeConfigProblem[]): void {
  if (problems.length > 0) throw new Error(formatRuntimeProblems(problems));
}

let installed: FacilisRuntimeConfig | null = null;
const EMPTY_RUNTIME: FacilisRuntimeConfig = Object.freeze({});

/** Installed once by the boot; every non-request consumer reads the same frozen object. */
export function installRuntimeConfig(runtime: FacilisRuntimeConfig): void {
  installed = runtime;
}

export function runtimeEnv(): FacilisRuntimeConfig {
  if (installed === null) {
    throw new Error("runtime config is not installed: resolve it during boot (D-224)");
  }
  return installed;
}

/**
 * Non-throwing read for paths that must work before a boot (unit tests, a request that never
 * reached the middleware): an uninstalled process sees an empty, frozen config, never a throw.
 */
export function peekRuntimeConfig(): FacilisRuntimeConfig {
  return installed ?? EMPTY_RUNTIME;
}

type Parsed = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly expected: string };

function parseEnvValue(raw: string, declaration: FacilisRuntimeDeclaration): Parsed {
  if (typeof declaration === "boolean") {
    const normalised = raw.trim().toLowerCase();
    if (normalised === "true" || normalised === "1") return { ok: true, value: true };
    if (normalised === "false" || normalised === "0") return { ok: true, value: false };
    return { ok: false, expected: "expected true|false|1|0" };
  }
  if (typeof declaration === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, expected: "expected a finite number" };
  }
  if (typeof declaration === "string" || declaration === null) return { ok: true, value: raw };
  return parseJson(raw, Array.isArray(declaration) ? "array" : "object");
}

function parseJson(raw: string, kind: "array" | "object"): Parsed {
  try {
    const parsed: unknown = JSON.parse(raw);
    const matches = kind === "array" ? Array.isArray(parsed) : isPlainObject(parsed);
    if (matches) return { ok: true, value: parsed as JsonValue };
  } catch {
    // Fall through to the typed error: the value never belongs in the message (it may be a secret).
  }
  return { ok: false, expected: `expected a JSON ${kind}` };
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBuildOnly(name: string): boolean {
  return BUILD_ONLY_ENV.some((entry) => entry === name);
}

function problem(
  code: RuntimeConfigProblemCode,
  envName: string,
  key: string | null,
  message: string,
): RuntimeConfigProblem {
  return { code, envName, key, message };
}

/** Nearest known name within a small edit distance, or null when the typo is not a near miss. */
function suggest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = 4;
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0] as number;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column] as number;
      const substitution = (left[row - 1] === right[column - 1] ? diagonal : diagonal + 1) as number;
      previous[column] = Math.min(above + 1, (previous[column - 1] as number) + 1, substitution);
      diagonal = above;
    }
  }
  return previous[right.length] as number;
}
