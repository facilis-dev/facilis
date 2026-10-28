// Client for the Facilis framework endpoints served by a project's in-VM dev server.
//
// SPEC §6 is the contract: /__facilis/manifest returns the full manifest envelope and
// /__facilis/manifest/revision is the cheap freshness poll (60 bytes) the Studio uses
// before refetching. Both are dev-only (404 in production) and origin-locked.
//
// The Studio reaches them through the preview proxy: a preview iframe's src is
// <studio-origin>/preview/<port>/, and the framework answers under that prefix, so every
// request is built from that base instead of the IDE origin. The client is deliberately
// throw-free — a panel that cannot reach its project shows "unreachable" instead of
// taking the editor down with it.

/** One non-fatal problem the framework reported while assembling the manifest. */
export interface ManifestWarning {
  message: string;
  code?: string;
  section?: string;
}

/** SPEC §6.2 response envelope. */
export interface ManifestEnvelope {
  revision: string;
  generatedAt: string;
  sections: string[];
  manifest: Record<string, unknown>;
  warnings: ManifestWarning[];
}

/** SPEC §6.3 freshness poll. */
export interface ManifestRevision {
  revision: string;
  generatedAt: string;
}

export type ManifestResult =
  | { ok: true; envelope: ManifestEnvelope; etag: string | null }
  | { ok: false; status: number; error: string };

export type RevisionResult =
  | { ok: true; revision: string; generatedAt: string }
  | { ok: false; status: number; error: string };

export interface ManifestQuery {
  /** SPEC §6.1: config, blocks, routes, schema, i18n, meta. Omitted = every section. */
  sections?: readonly string[];
  format?: "full" | "summary";
  signal?: AbortSignal;
}

const MANIFEST_PATH = "/__facilis/manifest";
const REVISION_PATH = "/__facilis/manifest/revision";

/** Strip the trailing slash so the endpoint path never doubles it. A non-proxy origin
 * (an external preview tab) works the same way. */
export function manifestBaseUrl(previewSrc: string): string {
  return previewSrc.trim().replace(/\/+$/, "");
}

function endpoint(baseUrl: string, path: string): string {
  const base = manifestBaseUrl(baseUrl);
  return base.length === 0 ? path : base + path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWarnings(value: unknown): ManifestWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: ManifestWarning[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.message !== "string") continue;
    const warning: ManifestWarning = { message: entry.message };
    if (typeof entry.code === "string") warning.code = entry.code;
    if (typeof entry.section === "string") warning.section = entry.section;
    warnings.push(warning);
  }
  return warnings;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    strings.push(entry);
  }
  return strings;
}

/** Narrow an unknown JSON body to the envelope, or null when the shape is wrong.
 * A partial manifest still has a revision and a warnings list (SPEC §6.4), so a
 * missing section is data, not a parse failure. */
export function parseEnvelope(value: unknown): ManifestEnvelope | null {
  if (!isRecord(value)) return null;
  if (typeof value.revision !== "string" || value.revision.length === 0) return null;
  if (typeof value.generatedAt !== "string") return null;
  const sections = readStringArray(value.sections);
  if (sections === null) return null;
  const manifest = isRecord(value.manifest) ? value.manifest : {};
  return {
    revision: value.revision,
    generatedAt: value.generatedAt,
    sections,
    manifest,
    warnings: readWarnings(value.warnings),
  };
}

/** SPEC §6.3 revision poll. */
export function parseRevision(value: unknown): ManifestRevision | null {
  if (!isRecord(value)) return null;
  if (typeof value.revision !== "string" || value.revision.length === 0) return null;
  return {
    revision: value.revision,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function getJson(
  url: string,
  signal?: AbortSignal,
): Promise<{ status: number; etag: string | null; body: unknown; networkError: string | null }> {
  try {
    const response = await fetch(url, { signal });
    const body: unknown = await response.json().catch(() => null);
    return {
      status: response.status,
      etag: response.headers.get("etag"),
      body,
      networkError: null,
    };
  } catch (error) {
    return { status: 0, etag: null, body: null, networkError: errorText(error) };
  }
}

/**
 * Fetch the full manifest (SPEC §6.2). Never throws: a booting, unreachable or broken
 * project comes back as ok:false with the reason, which is what the panels render.
 */
export async function fetchManifest(
  baseUrl: string,
  query: ManifestQuery = {},
): Promise<ManifestResult> {
  const params = new URLSearchParams();
  if (query.sections && query.sections.length > 0) params.set("sections", query.sections.join(","));
  if (query.format) params.set("format", query.format);
  const suffix = params.toString().length > 0 ? "?" + params.toString() : "";
  const result = await getJson(endpoint(baseUrl, MANIFEST_PATH) + suffix, query.signal);
  if (result.networkError !== null) return { ok: false, status: 0, error: result.networkError };
  if (result.status !== 200)
    return { ok: false, status: result.status, error: "HTTP " + result.status };
  const envelope = parseEnvelope(result.body);
  if (envelope === null)
    return { ok: false, status: result.status, error: "invalid manifest envelope" };
  return { ok: true, envelope, etag: result.etag };
}

/**
 * Poll the revision (SPEC §6.6: every 2s while visible, plus on visibilitychange). Keep
 * the previous revision in the caller and refetch the full manifest only when it changes.
 */
export async function fetchRevision(
  baseUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<RevisionResult> {
  const result = await getJson(endpoint(baseUrl, REVISION_PATH), options.signal);
  if (result.networkError !== null) return { ok: false, status: 0, error: result.networkError };
  if (result.status !== 200)
    return { ok: false, status: result.status, error: "HTTP " + result.status };
  const revision = parseRevision(result.body);
  if (revision === null)
    return { ok: false, status: result.status, error: "invalid revision body" };
  return { ok: true, revision: revision.revision, generatedAt: revision.generatedAt };
}
