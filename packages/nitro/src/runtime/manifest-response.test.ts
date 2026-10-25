import { describe, expect, it } from "vitest";

import {
  isNotModified,
  manifestHeaders,
  manifestResponse,
  notModifiedResult,
  parseEntityTags,
  summaryResponse,
  weakEtag,
} from "./manifest-response.ts";

const REVISION = "0123456789abcdef0123456789abcdef01234567";

describe("weakEtag", () => {
  it("wraps the revision as a weak validator", () => {
    expect(weakEtag(REVISION)).toBe(`W/"${REVISION}"`);
  });
});

describe("parseEntityTags", () => {
  it("returns no tags for a missing header", () => {
    expect(parseEntityTags(null)).toEqual([]);
  });

  it("strips weakness and quotes from a list", () => {
    expect(parseEntityTags(`W/"abc", "def"`)).toEqual(["abc", "def"]);
  });
});

describe("isNotModified", () => {
  it("matches the current revision in If-None-Match", () => {
    expect(isNotModified({ ifNoneMatch: `W/"${REVISION}"`, since: null, revision: REVISION })).toBe(
      true,
    );
  });

  it("matches a wildcard", () => {
    expect(isNotModified({ ifNoneMatch: "*", since: null, revision: REVISION })).toBe(true);
  });

  it("matches the since query parameter", () => {
    expect(isNotModified({ ifNoneMatch: null, since: REVISION, revision: REVISION })).toBe(true);
  });

  it("does not match stale or missing validators", () => {
    expect(isNotModified({ ifNoneMatch: `W/"other"`, since: "other", revision: REVISION })).toBe(
      false,
    );
    expect(isNotModified({ ifNoneMatch: null, since: null, revision: REVISION })).toBe(false);
  });
});

describe("manifestHeaders", () => {
  it("sets no-cache, the ETag, the revision header and partial marker", () => {
    expect(manifestHeaders(REVISION, true)).toEqual({
      "cache-control": "no-cache",
      etag: `W/"${REVISION}"`,
      "x-facilis-revision": REVISION,
      "x-facilis-partial": "true",
    });
    expect(manifestHeaders(REVISION, false)["x-facilis-partial"]).toBeUndefined();
  });
});

describe("manifestResponse", () => {
  it("returns a 200 full envelope", () => {
    const result = manifestResponse({
      revision: REVISION,
      generatedAt: "2026-01-01T00:00:00.000Z",
      sections: ["routes"],
      manifest: { routes: [] },
      warnings: [],
      partial: false,
    });
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(result.headers["etag"]).toBe(`W/"${REVISION}"`);
    expect(result.body).toMatchObject({ revision: REVISION, sections: ["routes"] });
  });

  it("builds an empty 304", () => {
    const result = notModifiedResult(REVISION);
    expect(result.status).toBe(304);
    expect(result.body).toBeUndefined();
  });
});

describe("summaryResponse", () => {
  it("serves the summary under its own key", () => {
    const result = summaryResponse({
      revision: REVISION,
      generatedAt: "2026-01-01T00:00:00.000Z",
      sections: ["config", "blocks", "routes", "schema", "i18n", "meta"],
      summary: {
        framework: { coreVersion: "0.0.0", nitroVersion: "0.0.0" },
        project: { dbMode: "pglite", releaseRef: "main", defaultLocale: "en" },
        counts: {
          blocks: 0,
          routes: 0,
          tables: 0,
          columns: 0,
          policies: 0,
          locales: 0,
          permissions: 0,
          roles: 0,
        },
        blocks: [],
        tables: [],
        locales: [],
      },
      warnings: [],
    });
    expect(result.status).toBe(200);
    const body = result.body as { summary: unknown; manifest?: unknown };
    expect(body.summary).toBeDefined();
    expect(body.manifest).toBeUndefined();
  });
});
