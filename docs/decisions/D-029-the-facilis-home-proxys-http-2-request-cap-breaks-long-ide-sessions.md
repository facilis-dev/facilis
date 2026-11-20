# D-029 — The facilis.home proxy's HTTP/2 request cap breaks long IDE sessions
**Status:** accepted (2026-10-28) — environment fix, no engine change

Serving the IDE dev server through the `facilis.home` HTTPS reverse proxy made every
generated-project install fail while the same tree on `http://127.0.0.1:<port>` passed. It is not
the certificate, the host alias, the SAB/preview path, pnpm, or the number of concurrent Process
Workers: **the proxy retires its HTTP/2 connection after 1000 requests, and Chromium loses a few
module fetches across that boundary.**

- Measured against the proxy with a bare Node HTTP/2 client: `GOAWAY` on request **#1000**
  exactly (`lastStreamID=1999`, advertised `max_concurrent_streams=100`) — nginx's
  `http2_max_requests` default (folded into `keepalive_requests` from 1.25.1 on), also 1000.
- A dev page session issues **thousands** of module requests: every guest process is a browser
  Worker that loads the runtime's ~190-module graph (the build ships one file per worker, dev
  serves each module separately). ~19 processes ≈ 3,600 requests → 3–4 connection retirements
  per install.
- Reproduced without the real proxy: a loopback HTTP/2 proxy in front of the same Vite server,
  with **only** a `GOAWAY` after 1000 requests added, loses **5 of 19** simultaneous module
  Workers; the identical proxy without that cap loses **0 of 19**. The same 19 through the real
  nginx with `--disable-http2`, or over loopback, lose 0 — HTTP/1.1 has no multiplexed in-flight
  requests to lose when a connection retires, which is why `pnpm ide:smoke` was always green.
- An empty-message `error` from a module Worker means "module graph failed to load"; the kernel
  correctly treats it as a fatal boot failure, so the install dies with
  `worker.js: process worker failed to start` and then `Worker pnpm#4 exited with code 1`.
- Both plausible engine-side workarounds were measured and **rejected**: throttling concurrent
  Process Worker boots (a validated patch capped the burst at three; request volume still crossed
  the boundary, so it only shifted the probability) and capping pnpm's pool from the generated
  template (`PNPM_WORKERS`; same flaw, plus a browser-VM limit in user-visible config). A dev
  cache header for `vendor/vivari/**` does not help either: worker graph fetches do not reuse the
  browser HTTP cache (193/193 requests from a warm Worker).

**Decision:** fix the proxy, not the engine. On the studio vhost raise or disable the
per-connection request cap — `keepalive_requests 100000;` (nginx ≥ 1.25.1) or
`http2_max_requests 100000;` (older) — or serve that vhost over HTTP/1.1 (`http2 off`), which is
a complete workaround for dev. Raising `http2_max_concurrent_streams` (the proxy advertises 100)
also helps the burst. Measurements: 1000 requests per connection, `GOAWAY` on request #1000 — the working notes were
Vivari-side and are not kept in this repo.

**Follow-up (same day):** D-031 removes the request *volume* instead of the cap — the IDE dev
server now runs Vite's full-bundle mode, so a dev session no longer issues thousands of module
requests and the `facilis.home` smoke passes with this proxy unchanged. Raising the cap is still
the right thing for any middleware-mode or otherwise long-lived dev session.

**Consequences:** this issue needs no fork of Vivari and no vendor patch; the IDE behind a
correctly configured proxy behaves like loopback, and bundle mode (D-031) makes it behave from an
unmodified proxy too. HTTP/1.1 remains the workaround for middleware mode until the proxy is
adjusted; the loopback smoke is unaffected either way.
