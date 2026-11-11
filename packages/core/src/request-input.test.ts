import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisEventContext, FacilisRequestEvent } from "./event.ts";
import { DEFAULT_MAX_JSON_BODY_BYTES, parseRequestInput } from "./request-input.ts";
import type { StorageApi } from "./storage.ts";

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;
const REQUEST_URL = "http://localhost/api/items";

function makeContext(storage?: StorageApi): FacilisEventContext {
  const context: FacilisEventContext = { params: {} };
  context.facilis = storage === undefined ? { db: FAKE_DB } : { db: FAKE_DB, storage };
  return context;
}

function makeEvent(request: Request, storage?: StorageApi): FacilisRequestEvent {
  return { context: makeContext(storage), req: request };
}

function jsonRequest(body: string): Request {
  return new Request(REQUEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function formRequest(form: FormData): Request {
  return new Request(REQUEST_URL, { method: "POST", body: form });
}

function smallForm(): FormData {
  const form = new FormData();
  form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  form.set("tag", "demo");
  return form;
}

async function errorOf(response: Response): Promise<{ code?: string; details?: unknown }> {
  return (await response.json()) as { code?: string; details?: unknown };
}

const JSON_SCHEMAS = { body: z.object({ title: z.string() }) };

describe("JSON body cap (SEC-09)", () => {
  it("parses a body under the cap", async () => {
    const outcome = await parseRequestInput(
      JSON_SCHEMAS,
      makeEvent(jsonRequest(JSON.stringify({ title: "ok" }))),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.body).toEqual({ title: "ok" });
    expect(outcome.form).toBeUndefined();
  });

  it("rejects an over-cap content-length before reading the body", async () => {
    const request = jsonRequest(JSON.stringify({ title: "ok" }));
    request.headers.set("content-length", String(DEFAULT_MAX_JSON_BODY_BYTES + 1));

    const outcome = await parseRequestInput(JSON_SCHEMAS, makeEvent(request));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.response.status).toBe(413);
    expect(await errorOf(outcome.response)).toEqual({
      code: "payload_too_large",
      details: { maxBytes: DEFAULT_MAX_JSON_BODY_BYTES },
    });
    // The header alone refused it: the streaming reader never ran.
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a stream without content-length once it grows past the cap", async () => {
    const request = jsonRequest("x".repeat(DEFAULT_MAX_JSON_BODY_BYTES + 1));
    expect(request.headers.get("content-length")).toBeNull();

    const outcome = await parseRequestInput(JSON_SCHEMAS, makeEvent(request));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.response.status).toBe(413);
    expect((await errorOf(outcome.response)).code).toBe("payload_too_large");
    expect(request.bodyUsed).toBe(true);
  });

  it("keeps a malformed JSON body as invalid_input", async () => {
    const outcome = await parseRequestInput(JSON_SCHEMAS, makeEvent(jsonRequest("{ not json")));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.response.status).toBe(400);
    expect((await errorOf(outcome.response)).code).toBe("invalid_input");
  });

  it("keeps the req.json() fallback for events without a body stream", async () => {
    const event: FacilisRequestEvent = {
      context: makeContext(),
      req: {
        headers: new Headers({ "content-type": "application/json" }),
        url: REQUEST_URL,
        method: "POST",
        json: async () => ({ title: "legacy" }),
      },
    };

    const outcome = await parseRequestInput(JSON_SCHEMAS, event);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.body).toEqual({ title: "legacy" });
  });
});

describe("multipart form cap (SEC-09)", () => {
  const FORM_SCHEMAS = { form: z.object({ file: z.instanceof(File), tag: z.string() }) };

  it("parses a form under the cap", async () => {
    const outcome = await parseRequestInput(FORM_SCHEMAS, makeEvent(formRequest(smallForm())));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.form.tag).toBe("demo");
    expect(outcome.form.file.name).toBe("note.txt");
  });

  it("rejects a form over the default cap", async () => {
    // A plain body keeps the test off undici's FormData encoder: the cap must fire from the
    // byte count, before multipart parsing ever runs.
    const request = new Request(REQUEST_URL, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=facilis-test" },
      body: "x".repeat(DEFAULT_MAX_JSON_BODY_BYTES + 1),
    });

    const outcome = await parseRequestInput(FORM_SCHEMAS, makeEvent(request));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.response.status).toBe(413);
    expect((await errorOf(outcome.response)).code).toBe("payload_too_large");
  });

  it("allows the configured upload limit plus multipart overhead", async () => {
    const maxUploadBytes = 512 * 1024;
    const storage = { available: true, maxUploadBytes } as unknown as StorageApi;
    const form = new FormData();
    // Above the 1 MiB JSON default, below maxUploadBytes + 1 MiB: the multipart cap applies.
    form.set("file", new File([new Uint8Array(1_200_000)], "upload.bin"));
    form.set("tag", "demo");

    const outcome = await parseRequestInput(FORM_SCHEMAS, makeEvent(formRequest(form), storage));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.form.file.size).toBe(1_200_000);
  });

  it("rejects a malformed multipart body as invalid_input", async () => {
    const request = new Request(REQUEST_URL, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=broken" },
      body: "not a multipart body",
    });

    const outcome = await parseRequestInput(FORM_SCHEMAS, makeEvent(request));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.response.status).toBe(400);
    expect((await errorOf(outcome.response)).code).toBe("invalid_input");
  });
});
