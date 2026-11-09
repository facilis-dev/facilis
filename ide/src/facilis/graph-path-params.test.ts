import { describe, expect, it } from "vitest";
import { pathParamsOf } from "./graph-path-params";

describe("pathParamsOf", () => {
  it("extracts OpenAPI/Nitro brace parameters in path order", () => {
    expect(pathParamsOf("/api/files/{id}")).toEqual(["id"]);
    expect(pathParamsOf("/api/files/{fileId}/versions/{versionId}")).toEqual([
      "fileId",
      "versionId",
    ]);
  });

  it("strips optional and catch-all markers from brace parameters", () => {
    expect(pathParamsOf("/api/files/{id?}")).toEqual(["id"]);
    expect(pathParamsOf("/api/files/{...slug}")).toEqual(["slug"]);
    expect(pathParamsOf("/api/files/{slug*}")).toEqual(["slug"]);
  });

  it("extracts Nitro file-router bracket parameters", () => {
    expect(pathParamsOf("/api/files/[id]")).toEqual(["id"]);
    expect(pathParamsOf("/api/files/[[id]]")).toEqual(["id"]);
    expect(pathParamsOf("/api/files/[...slug]")).toEqual(["slug"]);
    expect(pathParamsOf("/api/files/[[...slug]]")).toEqual(["slug"]);
  });

  it("keeps unique names only, in first-seen order", () => {
    expect(pathParamsOf("/api/{id}/children/{id}")).toEqual(["id"]);
    expect(pathParamsOf("/api/{first}/[second]/[[second]]")).toEqual(["first", "second"]);
  });

  it("returns an empty list when nothing is templated", () => {
    expect(pathParamsOf("/api/todos")).toEqual([]);
    expect(pathParamsOf("/")).toEqual([]);
    expect(pathParamsOf("")).toEqual([]);
    expect(pathParamsOf("src/pages/todos.tsx")).toEqual([]);
    // A file name is not a path segment template, so its bracket is left alone.
    expect(pathParamsOf("/api/files/[id].patch.ts")).toEqual([]);
  });
});
