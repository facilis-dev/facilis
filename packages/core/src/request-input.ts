import type { z } from "zod";

import { fail, invalidInput } from "./errors.ts";
import type { FacilisRequestEvent } from "./event.ts";

/**
 * Request input parsing shared by `defineAuthorizedHandler` (SPEC §7.4).
 *
 * JSON bodies (SPEC §8.2) and multipart forms (D-053) are mutually exclusive: the route
 * config declares one schema and the wrapper parses exactly that representation. Everything
 * here returns a `Response` on failure, so the caller stays free of h3/nitro imports.
 *
 * Bodies are byte-capped before parsing (SEC-09): `content-length` is rejected up front and
 * a stream without it is counted chunk by chunk, so an oversized payload is refused without
 * buffering it whole.
 */

export type PartFailure = { readonly ok: false; readonly response: Response };

export type ParseOutcome<B, Q, P, F> =
  | { readonly ok: true; readonly body: B; readonly query: Q; readonly params: P; readonly form: F }
  | PartFailure;

/** The four input schemas a route may declare; absent means "part not provided". */
export interface RequestSchemas<B = void, Q = void, P = void, F = void> {
  readonly body?: z.ZodType<B>;
  readonly form?: z.ZodType<F>;
  readonly query?: z.ZodType<Q>;
  readonly params?: z.ZodType<P>;
}

/** Default byte cap for a JSON body, enforced before parsing (SEC-09). */
export const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * Headroom a multipart envelope needs on top of the configured upload limit (boundaries and
 * per-part headers): the cap must never reject an upload that `storage.maxUploadBytes` allows.
 */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const JSON_BODY_REQUIRED_DETAILS = { formErrors: ["This route requires a JSON request body"] };
const JSON_BODY_INVALID_DETAILS = { formErrors: ["Request body must be valid JSON"] };
const FORM_BODY_REQUIRED_DETAILS = {
  formErrors: ["This route requires a multipart/form-data body"],
};
const FORM_BODY_INVALID_DETAILS = {
  formErrors: ["Request body must be valid multipart/form-data"],
};

type FormValue = string | File;

const JSON_MEDIA_TYPE = "application/json";
const FORM_MEDIA_TYPE = "multipart/form-data";

/**
 * The media type without its parameters, lowercased: `application/json; charset=utf-8` is JSON.
 * Checked from the header alone so a wrong type costs no parsing and never consumes the body.
 */
function mediaTypeOf(headers: Headers): string | undefined {
  const raw = headers.get("content-type");
  if (raw === null) return undefined;
  const [mediaType] = raw.split(";");
  const normalized = mediaType?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function wrongMediaType(event: FacilisRequestEvent, expected: string): PartFailure | undefined {
  if (mediaTypeOf(event.req.headers) === expected) return undefined;
  return { ok: false, response: fail("unsupported_media_type") };
}

function readQuery(event: FacilisRequestEvent): Record<string, string> {
  const url = event.req.url;
  if (typeof url !== "string") return {};
  try {
    // Repeated keys collapse to the last value; query schemas coerce the flat record.
    return Object.fromEntries(new URL(url).searchParams);
  } catch {
    return {};
  }
}

/** Multipart cap: the configured upload limit plus envelope overhead, else the JSON default. */
function formByteCap(event: FacilisRequestEvent): number {
  const maxUploadBytes = event.context.facilis?.storage?.maxUploadBytes;
  if (maxUploadBytes === undefined || maxUploadBytes <= 0) return DEFAULT_MAX_JSON_BODY_BYTES;
  return maxUploadBytes + MULTIPART_OVERHEAD_BYTES;
}

/**
 * The web `Request` body stream. The structural `FacilisRequest` contract declares only the
 * readers, so the stream is probed without importing h3/nitro; `undefined` means the event is
 * a test double that only exposes `json()`/`formData()`.
 */
function bodyStream(event: FacilisRequestEvent): ReadableStream<Uint8Array> | null | undefined {
  const req = event.req as FacilisRequestEvent["req"] & {
    readonly body?: ReadableStream<Uint8Array> | null;
  };
  return req.body;
}

/** `content-length` when it is a plain decimal; a malformed header defers to the counter. */
function declaredBodyBytes(headers: Headers): number | undefined {
  const raw = headers.get("content-length");
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function payloadTooLarge(cap: number): PartFailure {
  return { ok: false, response: fail("payload_too_large", { maxBytes: cap }) };
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

type BodyRead =
  { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> | undefined } | PartFailure;

/**
 * Reads the body under `cap`. An over-cap `content-length` is refused before touching the
 * stream; without the header the stream is counted chunk by chunk and cancelled as soon as it
 * exceeds the cap, so a chunked upload cannot buffer unbounded memory before the rejection.
 *
 * `bytes: undefined` means there is no stream to count (test doubles or a transport wrapper
 * exposing only the readers): the caller keeps the reader-method path and its limits.
 */
async function readCappedBody(
  event: FacilisRequestEvent,
  cap: number,
  invalidDetails: unknown,
): Promise<BodyRead> {
  const declared = declaredBodyBytes(event.req.headers);
  if (declared !== undefined && declared > cap) return payloadTooLarge(cap);
  const stream = bodyStream(event);
  if (stream === null || stream === undefined) return { ok: true, bytes: undefined };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- a body stream is consumed in order: each read is the next chunk, not an independent promise.
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        // Cancel instead of draining: the point of the cap is not to hold the payload.
        void reader.cancel().catch(() => undefined);
        return payloadTooLarge(cap);
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: fail("invalid_input", invalidDetails) };
  }
  return { ok: true, bytes: concatChunks(chunks) };
}

function parsePart<T>(
  schema: z.ZodType<T> | undefined,
  value: unknown,
): PartFailure | { ok: true; value: T } {
  if (schema === undefined) {
    // An absent schema means "part not provided": the context field is typed void.
    return { ok: true, value: undefined as unknown as T };
  }
  const result = schema.safeParse(value);
  if (!result.success) return { ok: false, response: invalidInput(result.error) };
  return { ok: true, value: result.data };
}

async function parseBody<T>(
  schema: z.ZodType<T> | undefined,
  event: FacilisRequestEvent,
): Promise<PartFailure | { ok: true; value: T }> {
  if (schema === undefined) return { ok: true, value: undefined as unknown as T };
  const unsupported = wrongMediaType(event, JSON_MEDIA_TYPE);
  if (unsupported !== undefined) return unsupported;
  const body = await readCappedBody(event, DEFAULT_MAX_JSON_BODY_BYTES, JSON_BODY_INVALID_DETAILS);
  if (!body.ok) return body;
  let raw: unknown;
  if (body.bytes !== undefined) {
    try {
      raw = JSON.parse(new TextDecoder().decode(body.bytes));
    } catch {
      return { ok: false, response: fail("invalid_input", JSON_BODY_INVALID_DETAILS) };
    }
  } else {
    const json = event.req.json;
    if (typeof json !== "function") {
      return { ok: false, response: fail("invalid_input", JSON_BODY_REQUIRED_DETAILS) };
    }
    try {
      raw = await json.call(event.req);
    } catch {
      return { ok: false, response: fail("invalid_input", JSON_BODY_INVALID_DETAILS) };
    }
  }
  return parsePart(schema, raw);
}

/** Repeated keys become arrays so Zod sees every uploaded file/field. */
function formDataToObject(form: FormData): Record<string, FormValue | FormValue[]> {
  const record: Record<string, FormValue | FormValue[]> = {};
  for (const [key, value] of form.entries()) {
    const current = record[key];
    if (current === undefined) {
      record[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      record[key] = [current, value];
    }
  }
  return record;
}

/** Parses already-capped multipart bytes through a web `Response`, so the cap stays authoritative. */
function cappedFormData(headers: Headers, bytes: Uint8Array<ArrayBuffer>): Promise<FormData> {
  const responseHeaders = new Headers();
  const contentType = headers.get("content-type");
  if (contentType !== null) responseHeaders.set("content-type", contentType);
  return new Response(bytes, { headers: responseHeaders }).formData();
}

async function parseForm<T>(
  schema: z.ZodType<T> | undefined,
  event: FacilisRequestEvent,
): Promise<PartFailure | { ok: true; value: T }> {
  if (schema === undefined) return { ok: true, value: undefined as unknown as T };
  const unsupported = wrongMediaType(event, FORM_MEDIA_TYPE);
  if (unsupported !== undefined) return unsupported;
  const body = await readCappedBody(event, formByteCap(event), FORM_BODY_INVALID_DETAILS);
  if (!body.ok) return body;
  let form: FormData;
  if (body.bytes !== undefined) {
    try {
      form = await cappedFormData(event.req.headers, body.bytes);
    } catch {
      return { ok: false, response: fail("invalid_input", FORM_BODY_INVALID_DETAILS) };
    }
  } else {
    const readFormData = event.req.formData;
    if (typeof readFormData !== "function") {
      return { ok: false, response: fail("invalid_input", FORM_BODY_REQUIRED_DETAILS) };
    }
    try {
      form = await readFormData.call(event.req);
    } catch {
      return { ok: false, response: fail("invalid_input", FORM_BODY_INVALID_DETAILS) };
    }
  }
  return parsePart(schema, formDataToObject(form));
}

export async function parseRequestInput<B, Q, P, F>(
  schemas: RequestSchemas<B, Q, P, F>,
  event: FacilisRequestEvent,
): Promise<ParseOutcome<B, Q, P, F>> {
  const params = parsePart(schemas.params, event.context.params ?? {});
  if (!params.ok) return params;

  const query = parsePart(schemas.query, readQuery(event));
  if (!query.ok) return query;

  if (schemas.form !== undefined) {
    const form = await parseForm(schemas.form, event);
    if (!form.ok) return form;
    return {
      ok: true,
      body: undefined as unknown as B,
      query: query.value,
      params: params.value,
      form: form.value,
    };
  }

  const body = await parseBody(schemas.body, event);
  if (!body.ok) return body;
  return {
    ok: true,
    body: body.value,
    query: query.value,
    params: params.value,
    form: undefined as unknown as F,
  };
}
