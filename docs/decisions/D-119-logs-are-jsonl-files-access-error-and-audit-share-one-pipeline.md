# D-119 — Logs are JSONL files: access, error and audit share one pipeline

**Status:** accepted (2026-11-08)

The owner asked for the last two platform features, the first being operator logging (audit /
access / error). Until now the only trail was the sudo audit (D-099): one stdout JSON line per
escalation, with the pipeline deliberately left open (O-014), and no access or error log at all.
The operational requirement is concrete: **in development the logs must be plain files that the
IDE's editor can open**; in production the deploy ships stdout (or the files) to its own log
platform.

**Decision.**

- **One pipeline, four kinds.** `@facilis.dev/core` owns the shapes: an `AccessLogEntry` (one per
  authorized request), an `ErrorLogEntry` (a server-side failure), an `AuditLogEntry`
  (security-relevant events, including the existing sudo trail) and an `AppLogEntry` (a line a
  route writes through `ctx.log`). Every entry carries a `ts`, a `level` and, when request-scoped,
  the correlation `requestId`, the user id, the session hash and the tenant — never the email,
  the cookie or a bearer token.
- **Access is structural.** `defineAuthorizedHandler` records exactly one access entry on
  **every** exit path: 401/403, `400 invalid_input`, `503 db_unavailable`, a handler result and an
  unexpected throw. The fields are method, pathname only (query strings can carry tokens),
  status, duration, request id, user id, session hash and tenant, plus the User-Agent only when
  `logging.includeUserAgent` is on. No route has to remember to log itself.
- **Errors stay server-side.** An unexpected handler failure is recorded with the canonical code
  (`internal_error`), the error name, message and stack; the client still receives only
  `{ code }` (SPEC §6.4). A missing logging runtime falls back to the previous `console.error`
  trace, so the wrapper stays usable in a bare Fetch runtime.
- **The audit stream is never filtered and stays fail-closed.** Audits ignore
  `logging.level`/`logging.access`/`logging.errors`; the db package's
  `setSudoAuditSink` is bridged into the same sink, so a sudo entry becomes
  `event: "sudo:started|succeeded|failed"` with its actor, roles, operation, reason, tables,
  request id, method/path, tenant, session hash, outcome, error code and duration. If the audit
  sink is not writable the write throws and sudo refuses to escalate (D-099 unchanged). Only the
  access/error/app streams are best-effort: a broken file must never fail a request.
- **Files, not an endpoint (owner decision, 2026-11-08).** Entries are JSON Lines in
  `<projectRoot>/.facilis/logs/{access,audit,error,app}.jsonl` (one object per line, no pretty
  printing), which is the project's existing internal-state directory. `FACILIS_LOG_SINK` =
  `auto|stdout|file|both` selects the sink: `auto` (the default) writes files when
  `NODE_ENV !== "production"` and stdout in production, so the IDE workflow needs no setup and a
  deploy needs no disk. `FACILIS_LOG_DIR`, `FACILIS_LOG_MAX_BYTES` (default 10 MiB),
  `FACILIS_LOG_KEEP` (default 5) and `FACILIS_LOG_LEVEL` complete the environment surface.
  Sinks are env-owned like the database target and storage credentials: a project must not be
  able to redirect an operator's trail.
- **No HTTP surface, not even dev-only.** A log endpoint would expose request paths, user ids,
  session hashes, client IPs and stack traces to anyone who can reach the dev server, and the
  dev origin allowlist is not a boundary inside the browser VM. The IDE viewer reads the files
  through the kernel VFS and opens them in the editor instead.
- **Redaction and caps.** Keys matching token/secret/password/cookie/authorization/set-cookie/
  api-key/credential/SAML payload/assertion/email/session-id (case-insensitive) are redacted in
  `data`/`details`; object depth 6, arrays 50, strings 1000 characters, cycles marked. Headers
  and request/response bodies are never logged.
- **Rotation and retention.** Before an append would pass the byte cap the active file shifts to
  `.1`, `.2` … keeping `FACILIS_LOG_KEEP` files; the writes are serialized synchronous appends
  (the runtime is single-process). Retention/WORM is the deploy's responsibility (O-019), not the
  framework's.
- **Tamper evidence.** File-written audit entries carry `seq`, `prevHash` and `hash` =
  SHA-256 over a stable canonical JSON of the entry without the hash fields, and
  `verifyAuditChain` verifies a readback. The chain is tamper-evident within a file, not
  tamper-proof (it has no secret key); a deploy that needs WORM ships the stdout/file stream to
  storage it cannot rewrite.
- **Request id.** The logging middleware accepts an inbound `x-request-id` only when it matches
  `^[A-Za-z0-9._-]{8,128}$` (otherwise it generates one), returns it in the response and puts it
  on the event context; the route wrapper reuses it, so access, error and audit entries for one
  request correlate without ever logging a header wholesale.
- **Config is small and defaulted.** `logging: { level, access, errors, includeUserAgent,
  trustProxy }` in `facilis.config.ts`; the environment overrides the level and owns the
  destination. `trustProxy` is off by default, so `x-forwarded-for` is ignored unless a deploy
  says it terminates a trusted proxy.

**Rejected alternatives.** *A database log table*: a rolled-back transaction would erase the
record of what it touched, it would write-amplify every request, and the audit trail must not be
subject to the RLS/write policy it describes. *A dev-only `GET /__facilis/dev/logs`* (the
original sketch): rejected by the owner — a log endpoint is a security liability, and files are
the artifact the IDE already knows how to open. *Per-route logging calls*: a route that forgets
one removes the security record; the wrapper is the only place that cannot forget. *Sampling
audit entries*: an audit trail with holes is not an audit trail. *A separate `FACILIS_AUDIT_SINK`
protocol*: the sudo audit is one of the four streams, not a parallel mechanism. *Logging the raw
`Drizzle` client's SQL*: query text can contain user data; pgaudit/log-statement is the
database-level tool for that (O-015).

**Consequences.** Development accumulates bounded log files inside `.facilis/` (already
gitignored), which operators and the IDE can inspect with any text tool; production defaults to
stdout so a platform can collect it; a project that wants files in production sets
`FACILIS_LOG_SINK=file`. Access volume is one line per API request, not per static asset. The
audit file doubles as the sudo trail with a verifiable chain, while WORM/HMAC and external sinks
remain open (O-019). The IDE viewer is read-only and cannot mutate or delete the files.

**Verification.** `@facilis.dev/core`: the config section defaults/cross-checks, access entry on
401/403/400/503/success/throw, error entry never reaches the client, audit actor for a session vs
anonymous, request-id fallback. `@facilis.dev/nitro`: env resolution and defaults, stream routing,
redaction/caps, level filtering, rotation and keep, audit chain verify (good and tampered),
fail-closed audit, best-effort access writes, middleware request-id/attach, bootstrap wiring and
the sudo bridge (the existing db sudo tests stay green). `@facilis.dev/ide`: the logs panel model
(parse, filters, rotation ordering) and its VFS read path. `docs/LOGS.md` is the operator
contract; the no-HTTP rule is also asserted by the absence of a route in the module registry.
