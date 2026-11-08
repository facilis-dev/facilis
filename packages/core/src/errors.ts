import { z } from "zod";

/**
 * Canonical API error contract (contracts §4.4, decision O-002).
 *
 * Responses carry codes, never prose: user-facing strings are translated client-side from
 * `t("error.<code>")` so the API stays locale-neutral.
 */

export const FACILIS_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "invalid_input",
  "conflict",
  "db_unavailable",
  "not_found",
  "storage_unavailable",
  "file_too_large",
  "internal_error",
] as const;

export type FacilisErrorCode = (typeof FACILIS_ERROR_CODES)[number];

/** HTTP status per code — the only place a status is chosen (contracts §4.4). */
export const FACILIS_ERROR_STATUS: Readonly<Record<FacilisErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  invalid_input: 400,
  conflict: 409,
  db_unavailable: 500,
  not_found: 404,
  storage_unavailable: 503,
  // 413: the upload is a valid form, but the file exceeds storage.maxUploadBytes.
  file_too_large: 413,
  internal_error: 500,
};

export interface FacilisErrorBody {
  code: FacilisErrorCode;
  details?: unknown;
}

/**
 * Builds the web `Response` for a Facilis error. Handlers return these directly; `h3`
 * treats a returned Response as the final response (contracts §4.4).
 */
export function fail(code: FacilisErrorCode, details?: unknown): Response {
  const body: FacilisErrorBody = details === undefined ? { code } : { code, details };
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  return new Response(JSON.stringify(body), { status: FACILIS_ERROR_STATUS[code], headers });
}

/** Flattens Zod issues into the `details` shape used by `invalid_input` responses. */
export function flattenZodIssues(error: z.ZodError) {
  return z.flattenError(error);
}

/** `400 invalid_input` with the flattened Zod issues as `details` (contracts §4.4). */
export function invalidInput(error: z.ZodError): Response {
  return fail("invalid_input", flattenZodIssues(error));
}
