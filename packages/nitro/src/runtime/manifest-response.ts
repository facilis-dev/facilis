import type {
  FacilisManifest,
  FacilisMetaResponse,
  ManifestSection,
  ManifestSummary,
  ManifestWarning,
} from "@facilis/core";

import { jsonResult, type HttpResult } from "./http.ts";

const NO_CACHE = "no-cache";

/** Weak ETag: the revision is stable content, not a strong representation validator. */
export function weakEtag(revision: string): string {
  return `W/"${revision}"`;
}

/** Split an If-None-Match list into bare revisions (weakness and quotes removed). */
export function parseEntityTags(header: string | null): string[] {
  if (header === null) return [];
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
    .filter((tag) => tag.length > 0);
}

/**
 * RFC 9110 conditional request handling for an ETag-based endpoint. `since` is the
 * spec's query-parameter shortcut (SPEC §6.1) and behaves like If-None-Match.
 */
export function isNotModified(input: {
  readonly ifNoneMatch: string | null;
  readonly since: string | null;
  readonly revision: string;
}): boolean {
  const tags = parseEntityTags(input.ifNoneMatch);
  if (tags.includes("*") || tags.includes(input.revision)) return true;
  return input.since !== null && input.since !== "" && input.since === input.revision;
}

export function manifestHeaders(revision: string, partial: boolean): Record<string, string> {
  return {
    "cache-control": NO_CACHE,
    etag: weakEtag(revision),
    "x-facilis-revision": revision,
    ...(partial ? { "x-facilis-partial": "true" } : {}),
  };
}

export function notModifiedResult(revision: string): HttpResult {
  return { status: 304, headers: manifestHeaders(revision, false) };
}

export function manifestResponse(input: {
  readonly revision: string;
  readonly generatedAt: string;
  readonly sections: readonly ManifestSection[];
  readonly manifest: Partial<FacilisManifest>;
  readonly warnings: readonly ManifestWarning[];
  readonly partial: boolean;
}): HttpResult {
  const body: FacilisMetaResponse = {
    revision: input.revision,
    generatedAt: input.generatedAt,
    sections: input.sections,
    manifest: input.manifest,
    warnings: input.warnings,
  };
  return jsonResult(200, body, manifestHeaders(input.revision, input.partial));
}

/**
 * `?format=summary` payload (SPEC §6.1, §14.1-11).
 *
 * Deviation from FacilisMetaResponse: ManifestSummary is not a Partial<FacilisManifest>,
 * so the compact view rides under `summary` instead of pretending to be a manifest.
 */
export interface FacilisSummaryResponse {
  readonly revision: string;
  readonly generatedAt: string;
  readonly sections: readonly ManifestSection[];
  readonly summary: ManifestSummary;
  readonly warnings: readonly ManifestWarning[];
}

export function summaryResponse(input: {
  readonly revision: string;
  readonly generatedAt: string;
  readonly sections: readonly ManifestSection[];
  readonly summary: ManifestSummary;
  readonly warnings: readonly ManifestWarning[];
}): HttpResult {
  const body: FacilisSummaryResponse = { ...input };
  return jsonResult(200, body, manifestHeaders(input.revision, false));
}
