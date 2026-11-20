# D-031 — The IDE dev server runs Vite's full-bundle mode
**Status:** accepted (2026-10-28)

Middleware-mode dev serves every module as its own request. A dev page session of the IDE is
therefore thousands of requests: each guest process is a browser Worker whose first act is
loading the runtime's module graph — ~190 `/@fs/` requests **per spawn** — and an install spawns
~11 of them. That volume, not the engine, is what brings the session into trouble (D-029: the
`facilis.home` proxy retires an HTTP/2 connection every 1000 requests and Chromium loses a few
in-flight fetches across the boundary; the loss kills a worker's graph load and with it the
install). Two measurements pointed the same way: the graph cannot be HTTP-cached from a Worker
(193/193 requests from a warm worker), and throttling concurrent boots only shifted the
probability.

**Decision:** the IDE's `dev` script runs `vite --host --experimentalBundle` (Vite 8's full
bundle mode, `experimental.bundledDev`). Rolldown serves a small set of chunks instead of one
response per module, so the request volume collapses: a process Worker no longer fetches a
190-request graph at all, and a whole dev session stays far below the proxy's per-connection
request cap. `dev:middleware` keeps the old server one command away for debugging Vite-plugin
behaviour (HMR semantics under bundle mode differ — boundaries are computed in the browser, and
`import.meta.hot` calls in dead branches fall back to a full reload; see Vite's
`experimental.bundledDev` note).

**Validation:** `TEMPLATE=Facilis pnpm ide:smoke` through `https://facilis.home/` with the
proxy **unchanged** (still retiring HTTP/2 connections at 1000 requests) is green end to end —
preview painted, framework checks, A8/A9/A10/A12 (the OPFS probe included) — where middleware
mode failed 15 checks on the same proxy. The loopback smoke is green in both modes.

**Consequences:** the IDE no longer depends on the dev proxy being configured for long
connections (raising the request cap in D-029 is still recommended for other reasons, but it is
no longer on the critical path); production builds were already bundled, so this only brings dev
in line with what ships. The cost is a bundling pass on the dev server (one ~1.3 MB chunk on
first request instead of hundreds of small ones) and Vite's experimental HMR semantics;
`dev:middleware` is the escape hatch if a Vite plugin misbehaves in bundle mode.
