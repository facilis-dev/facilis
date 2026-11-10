import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FacilisDb } from "@facilis/db";

import type { FacilisEventContext, FacilisRequestEvent } from "./event.ts";
import { defineAuthorizedHandler } from "./route.ts";
import type { StorageApi } from "./storage.ts";

const dbMock = vi.hoisted(() => {
  const runWithPolicyScope = vi.fn(
    async (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );
  return { runWithPolicyScope };
});

vi.mock("@facilis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis/db")>();
  return { ...actual, runWithPolicyScope: dbMock.runWithPolicyScope };
});

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;

interface FakeEventOptions {
  form?: FormData;
  formReaderFails?: boolean;
  storage?: StorageApi;
  /** `null` omits the header; multipart routes get a boundary-bearing header by default. */
  contentType?: string | null;
}

function makeEvent(options: FakeEventOptions = {}): FacilisRequestEvent {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set(
      "content-type",
      options.contentType ?? "multipart/form-data; boundary=facilis-test-boundary",
    );
  }
  const req: FacilisRequestEvent["req"] = {
    headers,
    url: "http://localhost/api/files",
    method: "POST",
  };
  if (options.formReaderFails) {
    req.formData = async () => {
      throw new Error("invalid multipart");
    };
  } else if (options.form !== undefined) {
    req.formData = async () => options.form as FormData;
  }
  const context: FacilisEventContext = { params: {} };
  context.auth = null;
  context.facilis = {
    db: FAKE_DB,
    ...(options.storage === undefined ? {} : { storage: options.storage }),
  };
  return { context, req };
}

async function readBody(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

beforeEach(() => {
  dbMock.runWithPolicyScope.mockClear();
});

describe("multipart form routes", () => {
  it("validates form fields and passes the parsed form to the handler", async () => {
    const form = new FormData();
    form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    form.set("tag", "demo");
    const route = defineAuthorizedHandler(
      {
        permission: [],
        dbTables: [],
        form: z.object({ file: z.instanceof(File), tag: z.string() }),
      },
      (_event, ctx) => ({ name: ctx.form.file.name, tag: ctx.form.tag }),
    );

    expect(await route(makeEvent({ form }))).toEqual({ name: "note.txt", tag: "demo" });
  });

  it("returns 400 invalid_input when the form violates its schema", async () => {
    const form = new FormData();
    form.set("tag", "demo");
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], form: z.object({ file: z.instanceof(File) }) },
      () => null,
    );

    const response = (await route(makeEvent({ form }))) as Response;
    expect(response.status).toBe(400);
    expect((await readBody(response)).code).toBe("invalid_input");
  });

  it("returns 415 when a form route gets a non-multipart media type", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], form: z.object({ file: z.instanceof(File) }) },
      () => null,
    );

    const response = (await route(
      makeEvent({ form: new FormData(), contentType: "application/json" }),
    )) as Response;

    expect(response.status).toBe(415);
    expect((await readBody(response)).code).toBe("unsupported_media_type");
  });

  it("returns 400 for an unreadable multipart body", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], form: z.object({ file: z.instanceof(File) }) },
      () => null,
    );

    const response = (await route(makeEvent({ formReaderFails: true }))) as Response;
    expect(response.status).toBe(400);
    expect((await readBody(response)).code).toBe("invalid_input");
  });

  it("rejects a route that declares both body and form", () => {
    expect(() =>
      defineAuthorizedHandler(
        {
          permission: [],
          dbTables: [],
          body: z.object({ title: z.string() }),
          form: z.object({ file: z.instanceof(File) }),
        },
        () => null,
      ),
    ).toThrow(/mutually exclusive/);
  });
});

describe("ctx.storage", () => {
  it("passes the runtime through and falls back to the unavailable API", async () => {
    const storage = { available: true, maxUploadBytes: 0 } as unknown as StorageApi;
    const seen: unknown[] = [];
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => {
      seen.push(ctx.storage);
      return null;
    });

    await route(makeEvent({ storage }));
    await route(makeEvent());

    expect(seen[0]).toBe(storage);
    expect((seen[1] as StorageApi).available).toBe(false);
  });
});
