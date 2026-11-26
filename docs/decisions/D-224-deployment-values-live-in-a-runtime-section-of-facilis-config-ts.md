# D-224 — Deployment values live in a `runtime` section of `facilis.config.ts`
**Status:** accepted (2026-11-26)

A generated project has three kinds of configuration but only one declared place. `facilis.config.ts`
is the build-time contract — the analyzer reads it statically, the release artifact and
`role_permissions` derive from it (D-064, D-158) — while everything a deployment can change was read
directly from `process.env` in about twenty modules (31 non-test read sites), each with its own
parsing and failure policy: `resolveLogSettings` warns and falls back, telemetry fails closed,
storage warns and returns a null API, `db-target` throws or degrades. The same value was parsed
independently in different packages — `FACILIS_PUBLIC_ORIGIN` three times — so a default could drift
between consumers. The browser had the opposite gap: only the RUM define (D-209) carried values into
the bundle, as a special case with no declared surface.

**Decision:** `facilis.config.ts` gains two sections. `runtime` is the server surface a deployment
can override; `public` is the client surface baked at build time. Every other section stays
build-time.

```ts
export default defineConfig({
  // build-time contract, unchanged: roles, schema, routes, i18n, security
  runtime: {
    // @facilis.dev/nitro — database
    databaseMode: "pglite",
    databaseUrl: { secret: true },        // the operator must supply it
    // @facilis.dev/nitro — operator logging
    logLevel: "info",
    logSink: "auto",
    logDir: null,
    logMaxBytes: 10485760,
    // @facilis.dev/nitro — telemetry (opt-in)
    telemetryEnabled: false,
  },
  public: {
    // baked into the client bundle: FACILIS_PUBLIC_* at build, never after
    appName: "My app",
    apiBaseUrl: "/api",
  },
});
```

**The file belongs to the app; the framework only requires.** There is no hidden defaults table that
decides at runtime. Every key the framework reads is declared in the file with its value, and every
key the app reads is declared by the app. `DEFAULT_RUNTIME` / `DEFAULT_PUBLIC` do not exist as merge
layers; the framework exports the canonical values **for tooling only** — the generator that writes a
new project, the `runtime-key-missing` message that prints the line to paste, and the upgrade engine
(D-065). The runtime never consults them. This is a deliberate, scoped inversion of D-034's "framework
defaults do not live in the project": Nitro options stay as they are, but a deployment's behaviour must
be readable from the repository, and a hidden default is exactly what makes it unknowable.

**Every declared key is defined.** A value is a literal, or `{ secret: true }` — which defines the
source (the environment) rather than the value. A key declared without either is `runtime-key-unset`,
an error. A key read without being declared is `runtime-key-undeclared`, an error. "Missing" is never
a silent `null`.

**Static validation is the gate, the boot is the backstop.** An analyzer pass reads the declared keys
from `facilis.config.ts` and the read sites from the project's code, then reports:

| diagnostic | when | severity |
|---|---|---|
| `runtime-key-undeclared` | `ctx.runtime.X` / `publicConfig().X` read, `X` not declared | error |
| `runtime-key-unset` | declared with neither a literal nor a secret marker | error |
| `runtime-key-missing` | a system package requires `X`, the file does not declare it | error (the message carries the line) |
| `runtime-key-server-only` | a `runtime` key read from client-reachable code, or a `public` key read through `ctx.runtime` | error |
| `runtime-key-unused` | declared, read by nobody | warning |
| `vite-env-direct` | `import.meta.env.VITE_*` read in the project's `src/**` or `server/**` | warning |

**Framework requirements are visible, not buried.** Each package exports a declarative
`runtimeRequirements` list — key, surface, secret, and an optional condition expressed over static
config values (`{ when: { storageDriver: "s3" } }`), never a function the analyzer cannot evaluate.
The generator writes the union into new projects, and a gate over the shipped examples and the IDE
template asserts every required key is declared. A package that starts reading a new key without the
examples being updated fails the gate. This is the same declaration-plus-verification shape as
`dbTables` (D-157).

**Naming.** One flat key is one variable: `FACILIS_` + UPPER_SNAKE(key) for `runtime`,
`FACILIS_PUBLIC_` + UPPER_SNAKE(key) for `public`. Keys are flat, so two paths can never collide and
no `__` depth separator exists. The name is the rule, not a computation over a nested path.

**Precedence.** `runtime`: the file's value → the process environment at boot. `public`: the file's
value → the environment at **build**; after the bundle exists nothing can change it, which is the
defining difference between the two surfaces. A browser has no environment, and no post-build
mechanism reads one. An app that needs per-deployment values at runtime fetches them from an
authorized route; none of them come from `public`.

**Secrets.** `{ secret: true }` is allowed only under `runtime`; under `public` it is a type error,
because everything in the bundle is public. The resolved server value is a `SecretString` box, never a
bare string: `reveal()` is the only way to obtain it, while `toJSON`, `toString` and the Node inspect
hook answer `"[redacted]"`. A debug log, a serialized error or a manifest dump cannot leak it. A
secret has no default: absent means `null` and the subsystem that needs it decides —
`storageDriver: "s3"` without keys is a refusal with a warning (D-053), not a boot failure. A var
exported empty is fatal: a blank secret is always a configuration mistake. Secrets declared by name in
another section (SSO `clientSecretEnv`, D-120) stay there; the runtime exposes
`secrets.fromEnvironment(name)`, which accepts only the names that declaration lists.

**Read surfaces.** `ctx.runtime` and `publicConfig()`; `runtimeEnv()` for boot, jobs, tasks,
workflows, seed and SSO. Requests and consumers receive frozen objects built once per process; nothing
reads `process.env` outside the resolver, and an analyzer pass (`no-direct-env`) reports a direct read
in the framework packages as an error and in project `server/**` as a warning. `publicConfig()` is the
only client accessor, backed by the `__FACILIS_PUBLIC_CONFIG__` define — the RUM mechanism (D-209)
generalized, no inline script and no CSP risk. The Studio and the manifest expose the schema (names,
types, values for `public`, `secret` flags for `runtime`) and never server secret values;
`.env.example` is generated from it and `pnpm facilis:env` prints provenance with redaction.

**`VITE_*` stays Vite's passthrough, with a nudge.** Third-party libraries keep reading
`import.meta.env.VITE_*` and the default `envPrefix` is untouched, because `public` values reach the
client through the define, not through Vite's env system. In the project's own `src/**` and
`server/**` a read is reported as `vite-env-direct` (warning): that code ships to the browser, so a
value belongs in `public` — typed, validated, secret-forbidden — and is read through
`publicConfig()`. Warn-only, like `import-cycle` (D-217): no AI-validator rule is added and §9.3 stays
at 23. There is no suppression comment; a third-party integration that needs the raw variable reads it
inside the library, where the analyzer never looks.

**Defaults are the app's, and they stop following the framework.** A default written in the file is
part of the app's code: when a framework release changes its recommended value, an existing project
keeps its own until the upgrade engine offers the bump as a diff (D-065). That is the cost of making
the value visible, and it is accepted: an unchanged deployment must not change behaviour under it
because a dependency published a new number.

**Editing inside the IDE.** The file is app-owned and editable in the Studio. A change to `runtime`
takes effect on the next boot: the dev server restarts rather than reloading a partial value set, and
there is exactly one validity rule. `public` follows the build it is part of.

**Moved keys.** For a value to have one home, the deployment-tunable keys leave the build-time
sections: `db.mode` → `runtime.databaseMode`; `logging.level`, `logging.trustProxy` →
`runtime.logLevel`, `runtime.logTrustProxy`; `storage.driver|bucket|region|endpoint|forcePathStyle`
→ `runtime.storageDriver`, `runtime.s3Bucket|s3Region|s3Endpoint|s3ForcePathStyle`. `runtime` and
`public` are excluded from `ConfigFacts`: they are data, never a security declaration.
`logging.access`, `logging.errors`, `logging.includeUserAgent`, `storage.maxUploadBytes`,
`storage.tokenTtlSeconds` and `storage.encryption.enabled` stay build-time: project policy, not
deployment choices.

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
| `FACILIS_STORAGE_ENCRYPTION_KEY` / `_KEY_ID` / `_RETIRED_KEYS` | `runtime.storageEncryptionKey` / `...KeyId` / `...RetiredKeys` (unchanged; retired keys are a JSON `keyId → key` map) |
| `FACILIS_TENANT_ID` | `runtime.tenantId` (unchanged) |
| `FACILIS_PUBLIC_ORIGIN` | `runtime.publicOrigin` (unchanged) |
| `FACILIS_EMAIL_WEBHOOK_URL` / `_TOKEN` | `runtime.emailWebhookUrl` / `emailWebhookToken` (unchanged) |
| `FACILIS_INITIAL_ADMIN` / `_TOKEN` | `runtime.initialAdmin` / `initialAdminToken` (unchanged) |
| `FACILIS_TELEMETRY` | `runtime.telemetryEnabled` → **`FACILIS_TELEMETRY_ENABLED`** (renamed) |
| `FACILIS_TELEMETRY_ENDPOINT` / `_ORIGINS` / `_SAMPLING` / `_SERVICE` / `_SPANS_PER_MIN` / `_TENANT_KEY` | `runtime.telemetry*` (unchanged) |
| `FACILIS_DEPLOYMENT_ID` | `runtime.deploymentId` (unchanged) |
| `FACILIS_STATE_DIR` | `runtime.stateDir` (unchanged; dev only) |
| `FACILIS_DEV_METRICS`, `FACILIS_TELEMETRY_FE` | build-only allowlist, neither section |

Array keys (`telemetryOrigins`, `storageEncryptionRetiredKeys`) are JSON validated by the same schema;
malformed JSON is a fatal parse error naming the key.

**Consequences.** A new deployment knob is one line in the file, visible in the diff, plus the
requirement line in the package that reads it. Forgetting it is a build error with the exact line to
paste, not a silent no-op. The build-time contract gets smaller and stays sealed. The release notes
must call out: an invalid log level or a non-numeric `FACILIS_LOG_MAX_BYTES` used to fall back silently
and now stops the boot with the offending name — deliberately loud, because a silently wrong log level
hides the incident that follows. `FACILIS_TELEMETRY` changes name. Defaults no longer move with the
framework.

**Alternatives rejected.** *Framework defaults merged underneath the project* (D-034's shape): it is
exactly the hidden value this decision removes, and the reason the user could not tell what a deployment
would do. *A catalog derived from the config schemas with `.meta({ env: true })`*: the variable name is
computed, so reading the code tells you nothing without replaying the rule. *A separate catalog file*: a
second surface to discover. *A nested section*: the `_` separator makes `a.bC` and `a.b.c` the same
name. *Aliasing the old names*: nothing is deployed at `0.1.x`. *Plain strings for secrets, redaction in
the logger*: one `console.log(ctx.runtime)` defeats it. *Runtime-readable public values*: a browser has
no environment; a per-deployment browser value is a route, not a config.

**Verification.** Resolver unit tests (precedence, JSON arrays, unknown-name suggestion, build-only
ignored, fatal vs refusal); canonical tooling values covering exactly the schema's keys, never merged
at runtime; `defineConfig`
rejects the moved keys with the replacement in the message; a boot test asserting the aggregated error
report and exit code; analyzer tests for the six diagnostics plus `no-direct-env` (framework error,
project warning) and `vite-env-direct` (project code warns, `vite.config.ts` and dependencies are
exempt); a non-leak test asserting that `JSON.stringify(resolved)`, template interpolation and
an inspect never contain a secret value, and that a blank secret is fatal; a `public` bundling test
proving `publicConfig()` is frozen into the client and that a secret marker under `public` does not
compile; the examples/template requirement gate; `pnpm facilis:env` snapshot (provenance, redaction).
