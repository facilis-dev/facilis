import { describe, expect, expectTypeOf, it } from "vitest";
import type { AuthContext } from "@facilis/auth";

import type { FacilisContext, FacilisRequestEvent } from "./event.ts";

describe("FacilisRequestEvent", () => {
  it("is satisfied by a plain structural event", () => {
    const event: FacilisRequestEvent = {
      context: { auth: null },
      req: { headers: new Headers() },
    };

    expect(event.req.headers).toBeInstanceOf(Headers);
    expect(event.context.auth).toBeNull();
  });

  it("accepts the h3/Nitro request surface without importing h3", () => {
    const event = {
      context: { params: { id: "42" }, auth: null },
      req: {
        url: "http://localhost/api/todos/42",
        method: "GET",
        headers: new Headers(),
        json: async () => ({ title: "write tests" }),
      },
      res: { headers: new Headers() },
    } satisfies FacilisRequestEvent;

    expect(event.req.url).toContain("/api/todos/42");
    expect(event.context.params).toEqual({ id: "42" });
  });

  it("types auth as nullable and exposes defaultTenantId for anonymous scoping", () => {
    expectTypeOf<FacilisContext["auth"]>().toEqualTypeOf<AuthContext | null | undefined>();
    expectTypeOf<NonNullable<FacilisContext["facilis"]>["defaultTenantId"]>().toEqualTypeOf<
      string | undefined
    >();
  });
});
