import type { z } from "zod";

import { fail, invalidInput } from "./errors.ts";
import type { FacilisRequestEvent } from "./event.ts";

/**
 * Request input parsing shared by `defineAuthorizedHandler` (SPEC §7.4).
 *
 * JSON bodies (SPEC §8.2) and multipart forms (D-053) are mutually exclusive: the route
 * config declares one schema and the wrapper parses exactly that representation. Everything
 * here returns a `Response` on failure, so the caller stays free of h3/nitro imports.
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
  const json = event.req.json;
  if (typeof json !== "function") {
    return { ok: false, response: fail("invalid_input", JSON_BODY_REQUIRED_DETAILS) };
  }
  let raw: unknown;
  try {
    raw = await json.call(event.req);
  } catch {
    return { ok: false, response: fail("invalid_input", JSON_BODY_INVALID_DETAILS) };
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

async function parseForm<T>(
  schema: z.ZodType<T> | undefined,
  event: FacilisRequestEvent,
): Promise<PartFailure | { ok: true; value: T }> {
  if (schema === undefined) return { ok: true, value: undefined as unknown as T };
  const unsupported = wrongMediaType(event, FORM_MEDIA_TYPE);
  if (unsupported !== undefined) return unsupported;
  const readFormData = event.req.formData;
  if (typeof readFormData !== "function") {
    return { ok: false, response: fail("invalid_input", FORM_BODY_REQUIRED_DETAILS) };
  }
  let form: FormData;
  try {
    form = await readFormData.call(event.req);
  } catch {
    return { ok: false, response: fail("invalid_input", FORM_BODY_INVALID_DETAILS) };
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
