// Client for GET /__facilis/security-surface.json (D-226, #235).
//
// The endpoint serves exactly the bytes of the release artifact, so the IDE's download must
// never re-serialize the document: it saves the response body as it arrived. The graph badge
// only needs the summary, and the route is dev-only, so an unavailable endpoint returns
// ok:false and the caller hides the badge — a production preview must not break the graph.

import { manifestBaseUrl } from "./manifest-client";

export const SECURITY_SURFACE_PATH = "/__facilis/security-surface.json";
export const SECURITY_SURFACE_FILENAME = "security-surface.json";
/** The only document version this IDE understands (D-226: additive fields keep it 1). */
export const SECURITY_SURFACE_VERSION = 1;

/** The counts the badge shows; the document's other sections are the artifact's business. */
export interface SecuritySurfaceSummary {
  standard: number;
  declared: number;
  undeclared: number;
  unknown: number;
}

/** The slice of the versioned document the IDE reads. */
export interface SecuritySurfaceDocument {
  version: number;
  project: string;
  revision: string;
  summary: SecuritySurfaceSummary;
}

export type SecuritySurfaceResult =
  | { ok: true; document: SecuritySurfaceDocument; bytes: Uint8Array }
  | { ok: false; status: number; error: string };

export type SecuritySurfaceSave = { ok: true } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-negative integer count, or null when the field is not one. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Narrow a response body to the document, or null. A wrong version is refused rather than
 * guessed: the badge must not display counts from a schema it does not understand.
 */
export function parseSecuritySurface(value: unknown): SecuritySurfaceDocument | null {
  if (!isRecord(value) || value.version !== SECURITY_SURFACE_VERSION) return null;
  const summary = value.summary;
  if (!isRecord(summary)) return null;
  const standard = count(summary.standard);
  const declared = count(summary.declared);
  const undeclared = count(summary.undeclared);
  const unknown = count(summary.unknown);
  if (standard === null || declared === null || undeclared === null || unknown === null) {
    return null;
  }
  return {
    version: SECURITY_SURFACE_VERSION,
    project: typeof value.project === "string" ? value.project : "",
    revision: typeof value.revision === "string" ? value.revision : "",
    summary: { standard, declared, undeclared, unknown },
  };
}

/** One request against the preview proxy, the way every framework endpoint is reached. */
function endpoint(baseUrl: string): string {
  const base = manifestBaseUrl(baseUrl);
  return base.length === 0 ? SECURITY_SURFACE_PATH : base + SECURITY_SURFACE_PATH;
}

/** Fetch and validate the document; never throws. */
export async function fetchSecuritySurface(
  baseUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<SecuritySurfaceResult> {
  try {
    const response = await fetch(
      endpoint(baseUrl),
      options.signal === undefined ? {} : { signal: options.signal },
    );
    if (!response.ok) {
      return { ok: false, status: response.status, error: "HTTP " + response.status };
    }
    // The bytes are what the artifact holds; the parse only decides whether they are ours.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const document = parseSecuritySurface(body);
    if (document === null) {
      return { ok: false, status: response.status, error: "invalid security surface document" };
    }
    return { ok: true, document, bytes };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The browser save: the received bytes in a Blob, wrapped rather than re-serialized. */
function saveSecuritySurfaceFile(bytes: Uint8Array, filename: string): void {
  // Kept local instead of reusing the project-export helper: that module also pulls the zip
  // and share-link machinery, which the graph panel has no use for.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Fetch the endpoint and save exactly its bytes as security-surface.json. The save is
 * injectable so tests can compare bytes without touching the DOM.
 */
export async function downloadSecuritySurface(
  baseUrl: string,
  options: {
    signal?: AbortSignal;
    save?: (bytes: Uint8Array, filename: string) => void;
  } = {},
): Promise<SecuritySurfaceSave> {
  const result = await fetchSecuritySurface(baseUrl, options);
  if (!result.ok) return { ok: false, error: result.error };
  (options.save ?? saveSecuritySurfaceFile)(result.bytes, SECURITY_SURFACE_FILENAME);
  return { ok: true };
}
