import { describe, expect, it } from "vitest";

import { routeFromRouteFile } from "./route-path.ts";

describe("routeFromRouteFile", () => {
  it("derives GET / from index.get.ts", () => {
    expect(routeFromRouteFile("index.get.ts")).toEqual({ method: "GET", path: "/" });
  });

  it("derives nested routes from index files", () => {
    expect(routeFromRouteFile("api/todos/index.post.ts")).toEqual({
      method: "POST",
      path: "/api/todos",
    });
  });

  it("converts [id] params to OpenAPI templates", () => {
    expect(routeFromRouteFile("api/todos/[id].patch.ts")).toEqual({
      method: "PATCH",
      path: "/api/todos/{id}",
    });
  });

  it("defaults to GET when the file name has no method suffix", () => {
    expect(routeFromRouteFile("api/health.ts")).toEqual({ method: "GET", path: "/api/health" });
  });

  it("drops route groups and env suffixes", () => {
    expect(routeFromRouteFile("(admin)/users/[id].delete.prod.ts")).toEqual({
      method: "DELETE",
      path: "/users/{id}",
    });
  });

  it("keeps catch-all params in OpenAPI form", () => {
    expect(routeFromRouteFile("files/[...path].get.ts")).toEqual({
      method: "GET",
      path: "/files/{*path}",
    });
  });

  it("normalizes backslashes", () => {
    expect(routeFromRouteFile("api\\todos\\index.ts")).toEqual({
      method: "GET",
      path: "/api/todos",
    });
  });

  it("returns undefined for unparseable names", () => {
    expect(routeFromRouteFile("")).toBeUndefined();
    expect(routeFromRouteFile(".get.ts")).toBeUndefined();
  });
});
