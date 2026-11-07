import { describe, expect, expectTypeOf, it } from "vitest";
import type { AuthContext } from "@facilis/auth";

import type {
  FacilisContext,
  FacilisHandlerContext,
  FacilisHandlerEvent,
  FacilisRequestEvent,
  FacilisResponse,
} from "./event.ts";

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
      res: { headers: new Headers(), status: 201, statusText: "Created" },
    } satisfies FacilisRequestEvent;

    expect(event.req.url).toContain("/api/todos/42");
    expect(event.context.params).toEqual({ id: "42" });
    expect(event.res.status).toBe(201);
  });

  it("types the response surface h3 merges into the final response", () => {
    expectTypeOf<FacilisResponse["headers"]>().toEqualTypeOf<Headers>();
    expectTypeOf<FacilisResponse["status"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FacilisResponse["statusText"]>().toEqualTypeOf<string | undefined>();
  });

  it("types auth as nullable and exposes defaultTenantId for anonymous scoping", () => {
    expectTypeOf<FacilisContext["auth"]>().toEqualTypeOf<AuthContext | null | undefined>();
    expectTypeOf<NonNullable<FacilisContext["facilis"]>["defaultTenantId"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("types the handler event without the raw root database client", () => {
    // D-099: a handler sees only the safe facilis fields; ctx.db is the policy-scoped client.
    expectTypeOf<NonNullable<FacilisHandlerContext["facilis"]>>().toEqualTypeOf<{
      defaultTenantId?: string;
    }>();
    expectTypeOf<NonNullable<FacilisHandlerContext["facilis"]>>().not.toHaveProperty("db");
    // A full request event (middleware, Nitro) is still assignable to the handler event.
    expectTypeOf<FacilisRequestEvent>().toMatchTypeOf<FacilisHandlerEvent>();
  });
});
