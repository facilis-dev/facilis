# D-053 — Binary storage is content-addressed, S3-compatible and behind a signed-URL proxy
**Status:** accepted (2026-11-01)

Files uploaded by a generated app need a home that works in the browser IDE and in
production without changing the app's code. Bytes never go in Postgres (only metadata):
the database stays small, RLS stays about rows, and the same blob can be shared by several
records.

**Blobs.** Addressed by their sha-256 hex digest, so identical content is stored once
(`put` is idempotent, there is no update-in-place). Dev writes
`<project>/.facilis/binary/<hh>/<hash>` through the project filesystem, which means the
VFS mirror persists them to OPFS like the dev database (D-052). Production uses a
S3-compatible bucket with the key `blobs/<hash>`. One Signature V4 driver covers AWS S3,
Cloudflare R2 and MinIO (endpoint + path style for the latter two); signing and presigning
are implemented on `node:crypto` + `fetch` — no AWS SDK in the framework.

**Package.** `@facilis.dev/storage` exports `contentHash`, `createLocalStorage`,
`createS3Storage` (`StorageDriver`: `put/get/exists/delete`, plus `signedGetUrl` on S3)
and the token helpers. Access control is not the driver's job: it never exposes the store
root, and the app's proxy route decides who may read a blob.

**Signed URLs.** A route checks access (the caller owns the file, or can read the entity it
is attached to) and then signs a short-lived HMAC token carrying `fileId`, `tenantId`,
`subject` and `expiresAt` (`buildSignedDownloadUrl`, default 5 min). `GET
/api/files/:id?token=…` verifies the token and streams the blob in dev or `302`s to a
driver-presigned S3 GET in production. GET is token-only so `<img src>` and shared links
work without a cookie; every mutation stays session-authenticated. The token is opaque
enough for URLs but readable (not encrypted); any change breaks the signature.

**Metadata and attachment.** `facilis_files` (id, hash, name, mime, size, owner_id,
tenant_id, created_at) ships from `@facilis.dev/db` with a restrictive tenant policy; access
to the bytes is decided by the routes that issue tokens. An entity "contains" files through
a generated link table: `fileLinks(todos, { table: "todo_files", column: "todo_id" })`
returns a table with cascading FKs to the parent row and `facilis_files`, a restrictive
tenant policy and a permissive `parent_access` policy:
`EXISTS (SELECT 1 FROM parent WHERE parent.pk = link.parent_id)`. Postgres evaluates that
subquery with the parent's own policies, so the link inherits the parent's access rules
instead of restating them — and the relation is a real, introspectable table in the schema,
manifest and release preview (a polymorphic `(entity_table, entity_id)` pair would have
neither FK integrity nor inherited RLS).

**No GC (for now).** Bodies are immutable and deduplicated, so an orphaned body costs only
space for content no longer referenced; reference counting or a sweeper is deferred. The
metadata row is what users see and delete.

**Verification.** `local.test.ts` pins dedupe, read, delete and the traversal guard;
`signing.test.ts` pins token round-trip, tamper, expiry and URL building; `s3.test.ts` pins
SigV4 headers, presigned URL shape, determinism and path-style vs virtual-host addressing;
`files.test.ts` pins the metadata/link schema and proves the RLS inheritance (a caller sees
only links to parents it can read, and cannot link to someone else's row). Cloud providers
still need an integration check against a real bucket; the signing vectors are structural
until then.

**Landed.** The runtime wiring — the `storage` section in `facilis.config.ts`,
`event.context.storage`/`ctx.storage`, the multipart `form` contract and the
`storeUpload`/`sendStoredFile` helpers — is **D-116**. The package APIs above are the
contract it builds on; the `FileUpload` block still uses them directly rather than a
framework wrapper.
