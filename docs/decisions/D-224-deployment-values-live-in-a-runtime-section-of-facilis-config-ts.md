# D-224 — Deployment values live in a `runtime` section of `facilis.config.ts`
**Status:** accepted (2026-11-26)

A generated project has two kinds of configuration but only one declared place. `facilis.config.ts`
is the build-time contract — the analyzer reads it statically, the release artifact and
`role_permissions` derive from it (D-064, D-158) — while everything a deployment can change was read
directly from `process.env` in about twenty modules (31 non-test read sites), each with its own
parsing and its own failure policy: `resolveLogSettings` warns and falls back, telemetry fails
closed, storage warns and returns a null API, `db-target` throws or degrades, `tenant` and
`http-guard` each re-implement their own default.

The names were flat and unrelated to the config keys (`FACILIS_LOG_LEVEL` for the `logging`
section, `FACILIS_STATE_DIR` for a dev-only path), nothing told an operator which variables a
deployment may set, and a project had no way to declare its own default for one. The same value was
parsed independently in different packages — `FACILIS_PUBLIC_ORIGIN` three times
(`packages/auth/src/sso/login.ts`, `packages/nitro/src/runtime/sso.ts`,
`packages/nitro/src/runtime/http-guard.ts`) — so a default could drift between consumers.

**Decision:** `facilis.config.ts` gains a **`runtime`** section. It is the only deployment-tunable
surface of the framework; every other section stays build-time.

```ts
export default defineConfig({
  // build-time contract, unchanged: roles, schema, routes, i18n, security
  runtime: {
    logLevel: "info",                 // FACILIS_LOG_LEVEL
    logTrustProxy: false,             // FACILIS_LOG_TRUST_PROXY
    databaseUrl: { secret: true },    // FACILIS_DATABASE_URL — a declaration, never a value
    s3Bucket: null,                   // FACILIS_S3_BUCKET
  },
});
```

- **Defaults live in core.** `DEFAULT_RUNTIME` in `@facilis.dev/core` carries a default for every
  non-secret key; `defineConfig` merges the project's section over it (the same shape as
  `DEFAULT_NITRO_OPTIONS`, D-034). A project declares only what it changes.
- **Precedence**, lowest to highest: `DEFAULT_RUNTIME` → the project's `runtime` section → the
  process environment. The first two are build-time values carried by the artifact; the third is
  the operator's and is never baked.
- **One flat key is one variable, and the name is the rule, not a computation over a nested path:**
  `FACILIS_` + the key in UPPER_SNAKE (`logTrustProxy` → `FACILIS_LOG_TRUST_PROXY`). Keys are flat,
  so two paths can never collide and no `__` depth separator exists.
- **Secrets carry no value in the file.** `{ secret: true }` declares the key and its env var; the
  value comes only from the environment, is validated as a non-empty string when present, is redacted
  in every error, boot log and generated artifact, and never reaches the manifest values.
- **A key that is not in `runtime` is not overridable, by construction.** The build-time sections
  (`auth.roles`, `i18n.locales`, `prerender.routes`, `security`, the schema) get no environment
  mapping at all, so the drift against the seeded `role_permissions` projection (D-158) cannot happen.
- **Unknown names are fatal.** Any `FACILIS_*` variable at boot that is neither a `runtime` key nor on
  the small build-only allowlist (`FACILIS_DEV_METRICS`, `FACILIS_TELEMETRY_FE`) fails the boot with the
  nearest known name suggested. The allowlist is literal, two entries, and the only way to add a build
  switch — this is what keeps "error on unknown" from breaking `vite dev`.
- **Read once, expose everywhere.** A single resolver (`resolveRuntimeConfig({ config, env })`) runs at
  boot and returns one frozen `FacilisRuntimeConfig`. Requests read `ctx.runtime`; jobs, tasks,
  workflows, the auth seed, the SSO login path and the bootstrap read `runtimeEnv()`, which returns
  that same object. `process.env` is read nowhere else: an analyzer pass (`no-direct-env`) reports a
  direct read in the framework packages as an error and in project `server/**` as a warning.
- **Two failure classes, kept apart.** A *contract* violation is fatal: unknown name, unparsable value
  (`FACILIS_LOG_TRUST_PROXY=yes`), answered `{ secret: true }` with an empty string, an explicit
  `databaseMode` that contradicts `databaseUrl`. A *subsystem refusal* keeps today's behaviour
  (D-053, D-068): a declared-but-unusable storage driver or an unreachable database degrades that
  subsystem with a warning instead of taking the boot down.

**Moved keys.** For a value to have one home, the deployment-tunable keys leave the build-time
sections: `db.mode` → `runtime.databaseMode`; `logging.level`, `logging.trustProxy` →
`runtime.logLevel`, `runtime.logTrustProxy`; `storage.driver|bucket|region|endpoint|forcePathStyle`
→ `runtime.storageDriver`, `runtime.s3Bucket|s3Region|s3Endpoint|s3ForcePathStyle`. `runtime` is
excluded from `ConfigFacts`: it is data, never a security declaration. `logging.access`,
`logging.errors`, `logging.includeUserAgent`, `storage.maxUploadBytes`, `storage.tokenTtlSeconds`
and `storage.encryption.enabled` stay build-time: they are project policy, not deployment choices.

**Migration (no deprecation window).** Names change once, here, while the packages are `0.1.x`; no
alias is kept.

| current | new |
|---|---|
| `FACILIS_DATABASE_URL` | `runtime.databaseUrl` (unchanged) |
| config `db.mode` | `runtime.databaseMode` → `FACILIS_DATABASE_MODE` |
| `FACILIS_LOG_LEVEL` / `_SINK` / `_DIR` / `_MAX_BYTES` / `_KEEP` | `runtime.logLevel` / `logSink` / `logDir` / `logMaxBytes` / `logKeep` (unchanged) |
| config `logging.trustProxy` | `runtime.logTrustProxy` → `FACILIS_LOG_TRUST_PROXY` |
| config `storage.driver` | `runtime.storageDriver` → `FACILIS_STORAGE_DRIVER` |
| config `storage.bucket` / `region` / `endpoint` / `forcePathStyle` | `runtime.s3Bucket` / `s3Region` / `s3Endpoint` / `s3ForcePathStyle` |
| `FACILIS_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_SESSION_TOKEN` | `runtime.s3AccessKeyId` / `s3SecretAccessKey` / `s3SessionToken` (unchanged) |
| `FACILIS_STORAGE_SECRET` | `runtime.storageSecret` (unchanged) |
| `FACILIS_STORAGE_ENCRYPTION_KEY` / `_KEY_ID` / `_RETIRED_KEYS` | `runtime.storageEncryptionKey` / `...KeyId` / `...RetiredKeys` (unchanged) |
| `FACILIS_TENANT_ID` | `runtime.tenantId` (unchanged) |
| `FACILIS_PUBLIC_ORIGIN` | `runtime.publicOrigin` (unchanged) |
| `FACILIS_EMAIL_WEBHOOK_URL` / `_TOKEN` | `runtime.emailWebhookUrl` / `emailWebhookToken` (unchanged) |
| `FACILIS_INITIAL_ADMIN` / `_TOKEN` | `runtime.initialAdmin` / `initialAdminToken` (unchanged) |
| `FACILIS_TELEMETRY` | `runtime.telemetryEnabled` → **`FACILIS_TELEMETRY_ENABLED`** (renamed) |
| `FACILIS_TELEMETRY_ENDPOINT` / `_ORIGINS` / `_SAMPLING` / `_SERVICE` / `_SPANS_PER_MIN` / `_TENANT_KEY` | `runtime.telemetry*` (unchanged) |
| `FACILIS_DEPLOYMENT_ID` | `runtime.deploymentId` (unchanged) |
| `FACILIS_STATE_DIR` | `runtime.stateDir` (unchanged; dev only) |
| `FACILIS_DEV_METRICS`, `FACILIS_TELEMETRY_FE` | build-only allowlist, not `runtime` |

Array keys (`telemetryOrigins`, `storageEncryptionRetiredKeys`) are JSON and validated by the same
Zod schema as the config file; a malformed JSON is a fatal parse error naming the key.

**Read surfaces.** `ctx.runtime` on `AuthorizedHandlerContext`; `runtimeEnv()` exported by
`@facilis.dev/core` for boot, jobs, tasks, workflows, seed and SSO. The resolved object is frozen and
built once; consumers never receive `process.env`. The Studio and the manifest expose the *schema*
(names, types, default, `secret`) and never secret values; ``.env.example` is generated from it, and
`pnpm facilis:env` prints the resolved table with provenance and redaction for an operator.

**Consequences.** A new deployment knob is one line in `runtime` plus one line in the docs table;
forgetting it is a boot error, not a silent no-op. The build-time contract gets smaller and stays
sealed. The behavior change to call out in the release notes: an invalid log level or a non-numeric
`FACILIS_LOG_MAX_BYTES` used to fall back silently and now stops the boot with the offending name —
a deliberately loud trade, because a silently wrong log level hides the incident that follows.
`FACILIS_TELEMETRY` changes name.

**Alternatives rejected.** *A catalog derived from the config schemas with `.meta({ env: true })`*:
the variable name is computed, so reading the code tells you nothing without replaying the rule,
and two nested paths can collide. *A separate catalog file*: a second surface to discover, and the
project's default for a knob lives away from the config it belongs to. *A nested `runtime`*: the
`_` separator makes `a.bC` and `a.b.c` the same name; flat keys cannot. *Aliasing the old names*:
nothing is deployed at `0.1.x`, and an alias table is a second source of truth to maintain.

**Verification.** Resolver unit tests (precedence, JSON arrays, secret redaction, unknown-name
suggestion, build-only ignored, fatal vs refusal); `defineConfig` rejects the moved keys with the
replacement in the message; a boot test asserting the aggregated error report and exit code; analyzer
tests for `no-direct-env` (framework error, project warning); `pnpm facilis:env` snapshot.
