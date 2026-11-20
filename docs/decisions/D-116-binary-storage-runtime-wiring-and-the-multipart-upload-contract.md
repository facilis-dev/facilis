# D-116 — Binary storage runtime wiring and the multipart upload contract

**Status:** accepted (2026-11-08)

D-053 shipped `@facilis.dev/storage` as a package — drivers, signing, metadata and link tables —
but left the runtime wiring open: a generated project could not upload anything without
hand-rolling the config section, the boot, the multipart parsing and the proxy route. The
template's file attachments are the Phase 1 proof that the whole path works inside the
WebContainer.

**Decision.**

- **Config.** `FacilisConfig.storage` carries only the non-secret half, and every key has a
  default: `driver: "local"` (default; `"s3"` in production), `bucket`/`region` (required
  with `"s3"`, validated at config load), `endpoint`/`forcePathStyle` for S3-compatible
  stores, `maxUploadBytes` default 10 MiB with a hard cap of 100 MiB, and
  `tokenTtlSeconds` default 300 s with a 24 h maximum. Secrets are environment only, never
  config: `FACILIS_S3_ACCESS_KEY_ID`, `FACILIS_S3_SECRET_ACCESS_KEY`, optional
  `FACILIS_S3_SESSION_TOKEN`, and `FACILIS_STORAGE_SECRET` (the download-token HMAC key).
- **Boot.** The `facilis-context` middleware resolves storage right after the config, before
  and independently of the database, and exposes it as `event.context.facilis.storage`;
  `defineAuthorizedHandler` passes it to the handler as `ctx.storage` and falls back to
  `unavailableStorage()` when the boot refused. A production boot with `driver: "local"`
  refuses storage (`storage_local_in_production`), an S3 driver without
  `FACILIS_S3_ACCESS_KEY_ID`/`FACILIS_S3_SECRET_ACCESS_KEY` is
  `storage_s3_credentials_missing`, production without the token secret is
  `storage_secret_missing`, and an unexpected driver-construction failure is
  `storage_boot_failed`. Every failure is a manifest warning (never the
  `storage_unavailable` error code) and degrades to `available: false`: the file routes
  answer `storage_unavailable` (503) while the rest of the app keeps working. Dev writes
  `<project>/.facilis/binary/<hh>/<hash>` through the project filesystem, so the VFS/OPFS
  mirror persists it; production uses S3 (or an S3-compatible endpoint) under `blobs/<hash>`.
- **Multipart.** `body` and `form` are mutually exclusive on `defineAuthorizedHandler`; with
  `form` the wrapper reads `req.formData()`, collapses repeated names to arrays, validates
  them with the declared Zod schema and hands the parsed fields to the handler as `ctx.form`.
  A missing or malformed multipart body is `invalid_input`; JSON routes are unchanged.
- **Helpers.** `@facilis.dev/nitro/storage` exports `storeUpload` (enforces
  `maxUploadBytes`, stores the bytes, inserts the `facilis_files` metadata row and returns
  `{ id, name, mime, size, url }`) and `sendStoredFile` (verifies the HMAC token, loads the
  metadata row and streams the blob, or redirects to a driver-presigned S3 GET). The helpers
  do not attach the file to a parent: the project route inserts the generated `fileLinks`
  row through `ctx.db`, so attachment stays an ordinary RLS-checked write.
- **Download.** `GET /api/files/:id?token=…` is written with `defineAuthorizedHandler` and
  `permission: []`: the short-lived token is the credential, so `<img src>` and shared links
  work without a cookie, while every mutation (upload, attach, delete) stays
  session-authenticated. Responses serve the stored mime with
  `x-content-type-options: nosniff` and an attachment `content-disposition`, so user content
  never renders as a privileged same-origin page.
- **Errors.** `file_too_large` (413) and `storage_unavailable` (503) join the closed core
  registry (O-002); malformed input stays `invalid_input` (400).
- **Metadata policies.** `facilis_files` ships **two** policies: a RESTRICTIVE
  `tenant_isolation` (the structural boundary) and a PERMISSIVE
  `facilis_files_tenant_access` whose predicate is just "a tenant is set"
  (`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`). A restrictive policy
  only narrows what a permissive one already allows, so without the permissive gate the
  policy-scoped `facilis_app` role cannot insert the metadata row (42501), exactly like the
  auth and job tables (D-008). The generated link table keeps its own restrictive tenant
  policy and the permissive `parent_access` policy that inherits the parent's RLS.
- **No GC.** D-053's rule is unchanged: bodies are immutable and deduplicated, and deleting
  the metadata row is what a user sees as deletion.

**Consequences.** A generated app gets working attachments from its first commit. A project
that declares nothing still has working dev storage, and when the boot degrades only the file
routes fail — the rest of the app is unaffected. Production refuses the dev driver instead of
silently writing local files a deployment cannot serve. The template's `todo_files` link
table makes the attachment a real, introspectable table (RLS inherited via `parent_access`),
and the analyzer synthesizes it from `fileLinks`, so the manifest, project graph and release
preview see it.

**Verification.** The `@facilis.dev/storage` suites from D-053; `@facilis.dev/core` route/config/
input/errors suites pin the form-XOR-body rule, the storage defaults/validation and the two
new codes; `@facilis.dev/nitro` covers the boot target and both helpers; `examples/todo-app`'s
`verify-headless.sh` uploads and downloads a file; the IDE drift tests
(`example-template`, `release-routes`, `release-schema`, `starter-contract`) pin the
template wiring; `pnpm ide:smoke` proves the path inside the WebContainer.
