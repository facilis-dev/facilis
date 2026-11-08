import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  FACILIS_ERROR_CODES,
  FACILIS_ERROR_STATUS,
  fail,
  flattenZodIssues,
  invalidInput,
  type FacilisErrorBody,
} from "./errors.ts";

async function readBody(response: Response): Promise<FacilisErrorBody> {
  return (await response.json()) as FacilisErrorBody;
}

describe("fail", () => {
  it("maps every error code to its documented status", async () => {
    const results = await Promise.all(
      FACILIS_ERROR_CODES.map(async (code) => {
        const response = fail(code);
        return { code, response, body: await readBody(response) };
      }),
    );

    for (const { code, response, body } of results) {
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(FACILIS_ERROR_STATUS[code]);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(body).toEqual({ code });
    }
  });

  it("uses the contract statuses", () => {
    expect(FACILIS_ERROR_STATUS).toEqual({
      unauthorized: 401,
      forbidden: 403,
      invalid_input: 400,
      conflict: 409,
      db_unavailable: 500,
      not_found: 404,
      storage_unavailable: 503,
      file_too_large: 413,
      internal_error: 500,
    });
  });

  it("includes details only when provided", async () => {
    const response = fail("not_found", { resource: "todo" });
    expect(await readBody(response)).toEqual({ code: "not_found", details: { resource: "todo" } });
  });

  it("returns conflict as 409", () => {
    expect(fail("conflict").status).toBe(409);
  });
});

describe("invalidInput", () => {
  it("returns 400 with flattened Zod issues", async () => {
    const schema = z.object({ title: z.string(), count: z.number() });
    const parsed = schema.safeParse({ title: 42 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const response = invalidInput(parsed.error);
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_input");
    expect(body.details).toEqual(flattenZodIssues(parsed.error));
    expect(body.details).toMatchObject({ fieldErrors: { title: expect.any(Array) } });
  });
});
