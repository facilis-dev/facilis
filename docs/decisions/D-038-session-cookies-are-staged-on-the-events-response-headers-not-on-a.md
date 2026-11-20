# D-038 — Session cookies are staged on the event's response headers, not on a returned `Response`
**Status:** accepted (2026-10-30)

Wiring the Facilis probe to a real database roundtrip — register, log in, insert a todo, read
it back — found a lost header. The login route returned `jsonResponse(..., { "Set-Cookie":
sessionCookie(...) })`, the shape the reference app had: the browser saw **200** with the JSON
body, so nothing looked wrong, and the next request arrived with **no `Cookie` header at all**
(`/api/auth/session` reported `{ authenticated: false, cookiePresent: false }`). The preview's
cookie jar was not the cause — the fork's `spike-cookie-session.mjs` proves the kernel attaches
and harvests cookies for a plain `node:http` session server — so the header was lost before the
jar saw it. Measured in the WebContainer: a `Set-Cookie` carried on a `Response` a route returns
does not survive this Nitro dev path, while a header staged on the event is merged into the
final response by h3 itself and does.

**Decision:** routes set or clear cookies with the framework's `setSessionCookie` /
`clearSessionCookie` helpers (`@facilis.dev/nitro/session`), which call h3's `setCookie` /
`deleteCookie`. h3 serialises the attributes and writes them to the event's response headers —
the same surface the first fix's manual `set("set-cookie", …)` used, but with append semantics
(a cookie another handler staged on that response is not clobbered) and one attribute set
(`HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in production) for every app. A route returns a
plain body. The reference app's login and logout use those helpers, and the probe proves the
whole chain: the session survives to the next request, the insert runs as the logged-in user,
and the list reads the row back.

Hand-rolling the `Set-Cookie` string was the wrong level: h3 already owns cookie serialisation
and the append rule, and the framework helper is where the h3 import belongs. It is a separate
entry point (`@facilis.dev/nitro/session`) because core's route contract is h3-free (contracts §4.1):
the single `FacilisRequestEvent` → `H3Event` narrowing lives in the helper, so handlers and
generated apps never import h3.

**Consequences:** any Facilis app sets cookies through `@facilis.dev/nitro/session`, never through a
returned `Response` — a route returning its own `Response` with `Set-Cookie` looks successful and
logs the user out on the next request in the WebContainer. Acceptance:
`TEMPLATE=Facilis pnpm ide:smoke` asserts the session, the insert and the query
(`facilisAuth`/`facilisDbInsert`/`facilisDbQuery`).
