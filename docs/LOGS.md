# Logs

**Status:** implemented (D-119).

How Facilis records access, errors and security-relevant audit events, where the entries go,
and how to verify them. This page is the operator contract behind D-119; the entry shapes are
owned by `@facilis/core` (see `packages/core/src/logging.ts`), the sink by `@facilis/nitro`.

There is **no HTTP endpoint that serves logs**. Not in development, not behind a flag. A log
endpoint would expose request paths, user ids, session hashes, client IPs and stack traces to
anyone who can reach the dev server, and the dev origin allowlist is not a boundary inside the
browser WebContainer (D-119). Logs are files, and the IDE reads them through the kernel VFS.

## Quick start

- **Development** needs no setup. With `FACILIS_LOG_SINK` unset, `NODE_ENV` is `development`/`test`
  selects the file sink: entries are appended to
  `<projectRoot>/.facilis/logs/{access,error,app,audit}.jsonl`.
  Open them in the IDE's editor (or the Logs panel, which renders the same files) and read one
  JSON object per line. `.facilis/` is in a generated project's `.gitignore`.
- **Production** defaults to stdout (`FACILIS_LOG_SINK` unset; anything but `development`/`test`, D-146): one JSON
  object per line on the process' stdout, so the deploy's log platform can ship it. A deploy
  that wants files instead sets `FACILIS_LOG_SINK=file` (or `both`).

Do not build an in-memory log API on top of this contract: the buffer/file is an operator
artifact, not an application resource.

## Streams

| File (file sink) | Kind | Written by | Content |
|---|---|---|---|
| `access.jsonl` | `access` | `defineAuthorizedHandler`, once per request, every exit path | method, pathname, status, duration, request id, user id, session hash, tenant, optional User-Agent |
| `error.jsonl` | `error` | `defineAuthorizedHandler` for an unexpected throw | canonical code, error name/message/stack, request facts. The client still receives only `{ code }` |
| `audit.jsonl` | `audit` | `ctx.log.audit`, the sudo bridge, framework flows (SSO) | event label, actor, operation, outcome, reason, tables, optional details |
| `app.jsonl` | `app` | `ctx.log.debug/info/warn/error` | message and optional redacted data |

Every entry carries `ts` (ISO-8601), `level` and — for request-scoped entries — `requestId`,
`userId`, `sessionHash` and `tenantId`. The raw session cookie, tokens, headers and
request/response bodies are never logged.

### Examples

```json
{"kind":"access","ts":"2026-11-08T12:00:00.000Z","level":"info","requestId":"8a7f...","method":"POST","path":"/api/order-requests","status":201,"durationMs":14,"userId":"...","sessionHash":"...","tenantId":"..."}
{"kind":"error","ts":"2026-11-08T12:00:00.000Z","level":"error","requestId":"8a7f...","code":"internal_error","name":"TypeError","message":"...","stack":"...","method":"POST","path":"/api/order-requests"}
{"kind":"audit","ts":"2026-11-08T12:00:00.000Z","level":"info","requestId":"8a7f...","event":"sudo:started","actor":"user:...","userId":"...","roles":["admin"],"operation":"order-request:cancel","reason":"cancel a request owned by another user","tables":["order_requests"],"method":"POST","path":"/api/order-requests","seq":1,"hash":"..."}
{"kind":"app","ts":"2026-11-08T12:00:00.000Z","level":"warn","requestId":"8a7f...","message":"retrying the upstream call","method":"POST","path":"/api/order-requests","data":{"attempt":2}}
```

File-written audit entries additionally carry `seq`, `prevHash` and `hash` (the tamper-evident
chain below); stdout entries stay plain objects.

## Configuration

`facilis.config.ts` owns only the request-facing defaults:

```ts
logging: {
  level: "info",              // minimum level for access/app entries; audit is never filtered
  access: true,               // one access entry per authorized request
  errors: true,               // server-side error entries
  includeUserAgent: false,    // off by default: less PII
  trustProxy: false,          // trust x-forwarded-for for the client IP
}
```

The client IP is collected **only** when `logging.trustProxy` is on (the first
`x-forwarded-for` value; the deploy must terminate a trusted proxy), and it is capped to 200
characters before it is written, so an oversized attacker-supplied header cannot inflate a log
line. The User-Agent is collected only when `logging.includeUserAgent` is on.

## Environment

Destination is a deployment concern and is env-owned, exactly like the database target and
storage credentials: a project must not be able to redirect an operator's trail.

| Variable | Values | Default | Meaning |
|---|---|---|---|
| `FACILIS_LOG_SINK` | `auto`, `stdout`, `file`, `both` | `auto` | `auto` = files when `NODE_ENV` is `development`/`test`, stdout otherwise (D-146) |
| `FACILIS_LOG_DIR` | path | `<projectRoot>/.facilis/logs` | File sink directory (relative paths resolve against the project root) |
| `FACILIS_LOG_MAX_BYTES` | integer | `10485760` (10 MiB) | Rotate the active file before an append would pass this size |
| `FACILIS_LOG_KEEP` | integer | `5` | Rotated files kept per stream (`0` discards on rotation) |
| `FACILIS_LOG_LEVEL` | `debug`, `info`, `warn`, `error` | config value | Overrides `logging.level` |

Invalid values fall back to the default above and surface as a `logging_env_invalid` warning in
the manifest instead of breaking the boot.

## Redaction and caps

`data` (app entries) and `details` (audit entries) are redacted recursively before serialization:

- Keys matching, case-insensitively, `token`, `secret`, `password`, `cookie`,
  `authorization`, `set-cookie`, `api_key`/`api-key`/`apiKey`, `credential`,
  `samlresponse`/`samlrequest`, `assertion`, `email` or `sessionid` become `"[redacted]"`.
- Object depth 6, arrays 50 items, strings 1000 characters; cycles are marked `"[circular]"`
  and unserializable objects `"[unserializable]"`.
- Free-text entry fields (message, stack, path, reason, `ip`, ...) are capped too; a single
  entry can never grow a log line unboundedly.

Headers and request/response bodies are never passed to the pipeline at all: the framework logs
shapes, not requests.

## Rotation and retention

The file sink appends synchronously and serialized (one writer per process, which is what makes
the audit chain exact). Before an append that would pass `FACILIS_LOG_MAX_BYTES`, the active
file shifts to `.1`, the older files shift by one, and the oldest beyond `FACILIS_LOG_KEEP` is
deleted: `access.jsonl` → `access.1.jsonl` → `access.2.jsonl` …

Retention and WORM storage are the deploy's responsibility, not the framework's: ship stdout (or
the files) to a store the application cannot rewrite. The framework never uploads or deletes
anything outside the rotated files it owns.

Failures are asymmetric by design:

- **Audit fails closed.** If the audit destination is not writable the write throws, sudo refuses
  to escalate (D-099) and a route's `ctx.log.audit` fails the request. An audit trail with holes
  is not an audit trail.
- **Access/error/app are best effort.** A broken file or stdout must never fail a request: those
  entries are dropped and the runtime reports the broken sink once on `console.error`. A broken
  log directory is a manifest warning at boot, not a boot failure. Note that a broken
  best-effort-only sink means evidence is lost until an operator fixes it.

## Audit hash chain

File-written audit entries are chained so tampering is detectable:

- `seq` starts at 1 and continues across restarts and rotations.
- `prevHash` is the previous entry's `hash` (absent only on the first entry of a fresh chain).
- `hash` = SHA-256 over a stable canonical JSON (sorted keys) of the entry without `hash`, so it
  covers `seq` and `prevHash` too.

The chain is tamper-**evident**, not tamper-proof: it has no secret key, so anyone who can write
the file can rebuild the chain. A deploy that needs tamper-proof retention ships the stream to
WORM storage it cannot rewrite. A corrupt or unreadable tail resets the chain with a
`logging_audit_chain_reset` boot warning rather than making the audit stream unwritable.

To verify a readback (the same function the tests use; it is an internal module, not a
package export):

```ts
import { readFileSync } from "node:fs";
import { verifyAuditChain } from "./packages/nitro/src/runtime/logging/audit-chain.ts";

const entries = readFileSync(".facilis/logs/audit.jsonl", "utf8")
  .split("\n")
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line) as unknown);

verifyAuditChain(entries); // { ok: true, entries: N } or { ok: false, brokenAt, reason }
```

(A rotated file starts mid-stream and is verified on its own: the first entry may have `seq > 1`
and a `prevHash`, which links it to the previous file.)

## Sudo and other framework audits

The database package's sudo trail is bridged into the same audit stream at boot
(`setSudoAuditSink`). A sudo event becomes `event: "sudo:started|succeeded|failed"` with its
actor, actor user id, roles, tenant, session hash, request id, method/path, operation, reason,
tables, outcome, error code and duration. Application routes add their own events through
`ctx.log.audit({ operation, outcome, reason, tables, details })`; the actor is derived from the
session (`user:<id>`, or `anonymous` when there is no session) and never supplied by the caller.

## Verifying the implementation

```bash
pnpm --filter @facilis/nitro test
```

The suites cover env resolution/defaults, redaction and caps (including the client-IP cap),
level/access/error filtering, audit being unfiltered, rotation/keep, audit-chain verification on
good and tampered readbacks, middleware request-id handling and attachment, bootstrap defaults,
the sudo bridge and fail-closed audit writes.
