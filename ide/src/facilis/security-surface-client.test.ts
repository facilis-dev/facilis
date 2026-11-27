// The security-surface client (D-226, #235): the document is validated by version and summary
// counts, and the download must save the endpoint's exact bytes — the artifact is compared
// byte-for-byte across releases, so a re-serialization here would be a different file.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadSecuritySurface,
  fetchSecuritySurface,
  parseSecuritySurface,
  SECURITY_SURFACE_FILENAME,
  SECURITY_SURFACE_PATH,
} from "./security-surface-client";

const DOCUMENT = {
  version: 1,
  project: "todo-app",
  revision: "3f2a1c",
  summary: { standard: 4, declared: 2, undeclared: 0, unknown: 1 },
  routes: [],
  extensions: [],
  imports: [],
  dynamicCode: [],
  unknown: [],
};

/** The exact bytes a real endpoint would send: the serializer's two-space JSON + newline. */
const BODY = JSON.stringify(DOCUMENT, null, 2) + "\n";

function respond(body: string, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(body, { status, headers: { "content-type": "application/json" } }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseSecuritySurface", () => {
  it("accepts the versioned document and reads its summary", () => {
    expect(parseSecuritySurface(DOCUMENT)).toEqual({
      version: 1,
      project: "todo-app",
      revision: "3f2a1c",
      summary: { standard: 4, declared: 2, undeclared: 0, unknown: 1 },
    });
  });

  it("rejects a different document version instead of guessing", () => {
    expect(parseSecuritySurface({ ...DOCUMENT, version: 2 })).toBeNull();
    expect(parseSecuritySurface({ ...DOCUMENT, version: "1" })).toBeNull();
    expect(parseSecuritySurface({ ...DOCUMENT, version: undefined })).toBeNull();
  });

  it("rejects a summary that is missing or not counts", () => {
    expect(parseSecuritySurface({ ...DOCUMENT, summary: undefined })).toBeNull();
    expect(
      parseSecuritySurface({
        ...DOCUMENT,
        summary: { standard: 1, declared: 1, undeclared: -1, unknown: 0 },
      }),
    ).toBeNull();
    expect(
      parseSecuritySurface({ ...DOCUMENT, summary: { standard: 1, declared: 1, undeclared: 0 } }),
    ).toBeNull();
    expect(parseSecuritySurface("{}")).toBeNull();
    expect(parseSecuritySurface(null)).toBeNull();
  });
});

describe("fetchSecuritySurface", () => {
  it("fetches the document through the preview base and keeps the exact bytes", async () => {
    respond(BODY);
    const result = await fetchSecuritySurface("http://host/preview/3000/?__vv_kernel=abc");
    expect(fetch).toHaveBeenCalledWith(
      "http://host/preview/3000" + SECURITY_SURFACE_PATH,
      expect.anything(),
    );
    if (!result.ok) throw new Error("the document must parse");
    expect(result.document.summary.unknown).toBe(1);
    expect(Buffer.from(result.bytes).toString("utf8")).toBe(BODY);
  });

  it("reports an unavailable endpoint without throwing", async () => {
    respond("", 404);
    const result = await fetchSecuritySurface("http://host/preview/3000");
    expect(result).toEqual({ ok: false, status: 404, error: "HTTP 404" });
  });

  it("reports a wrong version as unavailable, so the badge hides", async () => {
    respond(JSON.stringify({ ...DOCUMENT, version: 2 }));
    const result = await fetchSecuritySurface("http://host/preview/3000");
    expect(result).toMatchObject({ ok: false, error: "invalid security surface document" });
  });

  it("reports a network failure and a non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    expect(await fetchSecuritySurface("http://host/preview/3000")).toEqual({
      ok: false,
      status: 0,
      error: "connection refused",
    });
    respond("<html>not json</html>");
    expect((await fetchSecuritySurface("http://host/preview/3000")).ok).toBe(false);
  });
});

describe("downloadSecuritySurface", () => {
  it("saves exactly the bytes the endpoint returned", async () => {
    respond(BODY);
    const saved: { bytes: Uint8Array; filename: string }[] = [];
    const result = await downloadSecuritySurface("http://host/preview/3000", {
      save: (bytes, filename) => saved.push({ bytes, filename }),
    });
    expect(result).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.filename).toBe(SECURITY_SURFACE_FILENAME);
    expect(Buffer.from(saved[0]?.bytes ?? new Uint8Array()).toString("utf8")).toBe(BODY);
  });

  it("saves nothing when the endpoint is unavailable", async () => {
    respond("", 404);
    const save = vi.fn();
    expect(await downloadSecuritySurface("http://host/preview/3000", { save })).toEqual({
      ok: false,
      error: "HTTP 404",
    });
    expect(save).not.toHaveBeenCalled();
  });
});
