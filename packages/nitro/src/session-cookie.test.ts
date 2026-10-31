import { describe, expect, it } from "vitest";
import type { FacilisRequestEvent } from "@facilis/core";

import { clearSessionCookie, sessionIdFromRequest, setSessionCookie } from "./session-cookie.ts";

/**
 * The cookie is written through h3's `setCookie`, so these tests pin the two properties a
 * route depends on: the session cookie carries the contract's attributes (contracts §4.4),
 * and it lands on the EVENT's response headers (D-038) without clobbering a cookie another
 * handler staged on the same response.
 */

function fakeEvent(options: { headers?: Headers; cookie?: string } = {}): {
  event: FacilisRequestEvent;
  headers: Headers;
} {
  const headers = options.headers ?? new Headers();
  const init = options.cookie === undefined ? undefined : { headers: { cookie: options.cookie } };
  const event: FacilisRequestEvent = {
    context: {},
    req: new Request("http://localhost/api/auth/login", init),
    res: { headers },
  };
  return { event, headers };
}

describe("setSessionCookie", () => {
  it("writes the session cookie with the contract attributes", () => {
    const { event, headers } = fakeEvent();
    setSessionCookie(event, "session-1", { ttlMs: 60_000 });

    const [cookie] = headers.getSetCookie();
    expect(cookie).toBeDefined();
    expect(cookie).toContain("facilis_session=session-1");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=60");
    // Secure only in production: the probe runs over http:// in the WebContainer.
    expect(cookie).not.toContain("Secure");
  });

  it("appends, so a cookie already staged on the response survives", () => {
    const { event, headers } = fakeEvent();
    headers.set("set-cookie", "theme=dark; Path=/");
    setSessionCookie(event, "session-1", { ttlMs: 1_000 });

    expect(headers.getSetCookie()).toHaveLength(2);
    expect(headers.getSetCookie()[0]).toBe("theme=dark; Path=/");
  });

  it("replaces its own cookie instead of stacking a duplicate", () => {
    const { event, headers } = fakeEvent();
    setSessionCookie(event, "first", { ttlMs: 1_000 });
    setSessionCookie(event, "second", { ttlMs: 1_000 });

    expect(headers.getSetCookie()).toHaveLength(1);
    expect(headers.getSetCookie()[0]).toContain("facilis_session=second");
  });

  it("adds Secure when asked (production)", () => {
    const { event, headers } = fakeEvent();
    setSessionCookie(event, "session-1", { ttlMs: 1_000, secure: true });
    expect(headers.getSetCookie()[0]).toContain("Secure");
  });

  it("refuses an event with no response surface instead of dropping the cookie", () => {
    const event: FacilisRequestEvent = { context: {}, req: new Request("http://localhost/") };
    expect(() => setSessionCookie(event, "session-1", { ttlMs: 1_000 })).toThrow(
      /response headers/,
    );
  });
});

describe("clearSessionCookie", () => {
  it("expires the session cookie", () => {
    const { event, headers } = fakeEvent();
    clearSessionCookie(event);

    const [cookie] = headers.getSetCookie();
    expect(cookie).toContain("facilis_session=;");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
  });
});

describe("sessionIdFromRequest", () => {
  it("reads the session id next to other cookies", () => {
    const { event } = fakeEvent({ cookie: "theme=dark; facilis_session=session-1; other=1" });
    expect(sessionIdFromRequest(event)).toBe("session-1");
  });

  it("returns null when the request carries no session", () => {
    expect(sessionIdFromRequest(fakeEvent().event)).toBeNull();
    expect(sessionIdFromRequest(fakeEvent({ cookie: "theme=dark" }).event)).toBeNull();
    expect(sessionIdFromRequest(fakeEvent({ cookie: "facilis_session=" }).event)).toBeNull();
  });
});
