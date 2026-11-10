/**
 * The app's only fetch wrapper (docs/FRONTEND.md section 3).
 *
 * The API speaks error codes, never prose, and everything lives under the same origin as the
 * page. One place translates HTTP/JSON into that contract so pages only see ApiError.
 */

const PREVIEW_PATH = /^\/preview\/([^/]+)/;

const KNOWN_ERROR_CODES = new Set([
  "unauthorized",
  "forbidden",
  "invalid_input",
  "conflict",
  "db_unavailable",
  "not_found",
  "internal_error",
  "network_error",
  "file_too_large",
  "storage_unavailable",
  "unsupported_media_type",
]);

/**
 * The base path the app is mounted under: "/preview/<port>" in the IDE preview, "" when it is
 * deployed normally. It is derived from the pathname so react-router and fetch agree on where
 * the routes and the API live (the preview frame is served under the same prefix).
 */
export function appBasePath(pathname?: string): string {
  const path =
    pathname ?? (typeof globalThis.location === "undefined" ? "/" : globalThis.location.pathname);
  const match = PREVIEW_PATH.exec(path);
  return match === null ? "" : "/preview/" + match[1];
}

/** One API failure: a framework error code plus the HTTP status and optional details. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, details?: unknown) {
    super("API error: " + code + " (" + status + ")");
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isErrorBody(value: unknown): value is { code: string; details?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

async function readErrorBody(response: Response): Promise<{ code: string; details?: unknown }> {
  try {
    const body: unknown = await response.json();
    if (isErrorBody(body)) return { code: body.code, details: body.details };
  } catch {
    // A proxy or an HTML error page is not JSON: fall through to the generic code below.
  }
  return { code: "internal_error" };
}

/**
 * Calls the JSON API. Paths are app-relative ("/api/todos"); the preview base path and the
 * same-origin session cookie are added here. A 204 (or an empty body) resolves to undefined.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  const hasBody = init.body !== undefined && init.body !== null;
  // FormData carries its own multipart boundary: setting application/json here would make
  // the server parse the upload as a JSON body and reject it as invalid_input.
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (hasBody && !isFormData && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(appBasePath() + path, {
      credentials: "same-origin",
      ...init,
      headers,
    });
  } catch {
    // fetch only rejects on transport failures; the server never sent an error code.
    throw new ApiError("network_error", 0);
  }

  if (!response.ok) {
    const { code, details } = await readErrorBody(response);
    throw new ApiError(code, response.status, details);
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.trim().length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("internal_error", response.status);
  }
}

/**
 * Uploads one file as `multipart/form-data`; the framework route reads it with a `form`
 * schema (D-053). The browser sets the boundary, so no content type is passed here.
 */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return api<T>(path, { method: "POST", body: form });
}

/** Maps any thrown value to the catalogue key of its code: "errors.<code>". */
export function errorMessageKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "internal_error";
  return KNOWN_ERROR_CODES.has(code) ? "errors." + code : "errors.internal_error";
}
