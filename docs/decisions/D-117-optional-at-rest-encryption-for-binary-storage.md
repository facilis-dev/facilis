# D-117 — Optional at-rest encryption for binary storage

**Status:** accepted (2026-11-08)

D-053 and D-116 store every blob in plaintext: the local driver writes plaintext into the
project's VFS/OPFS, and production writes plaintext into an S3-compatible bucket. S3 SSE
protects the bucket, but not a copied body, a bucket operator, or a dev mirror. Some
deployments need the stored bytes unreadable while keeping D-053/D-116's content-addressing,
dedupe and presign path unchanged for every project that does not ask for it, so encryption
is an opt-in layer rather than a new default. It also has to fit the streaming rule: the
storage, crypto and download path never buffers a whole file (the platform's multipart parser
is the one place the upload is materialized, and it is bounded by `maxUploadBytes`).

**Decision.**

- **Config.** `storage.encryption = { enabled: boolean }`, default `false`, is the only
  encryption value in `facilis.config.ts`; the schema is strict (an unknown key is a config
  error) and the whole section still defaults, so a project that declares nothing keeps
  D-116's plaintext behaviour. Key material is environment only.
- **Keys.** `FACILIS_STORAGE_ENCRYPTION_KEY` is the active key-encryption key (KEK): 32 bytes
  as base64 or as a 64-character hex string, required when encryption is enabled.
  `FACILIS_STORAGE_ENCRYPTION_KEY_ID` labels it (default `primary`; `/^[A-Za-z0-9._-]{1,64}$/`,
  embedded in the blob header, so it must be safe ASCII).
  `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS` is an optional JSON object `{ keyId: key }` of
  decrypt-only rotation keys. Dev needs an explicit key too: unlike the download-token secret
  there is no per-boot random fallback, because blobs written with a one-boot key would become
  undecryptable after a restart.
- **Warnings.** Enabled without a key is the `storage_encryption_key_missing` manifest
  warning; an unparseable key, an invalid key id or malformed retired-keys JSON is
  `storage_encryption_key_invalid`. Like D-116's warnings they never fail the boot:
  `ctx.storage.available` is false and the file routes answer `storage_unavailable` (503)
  while the rest of the app keeps working.
- **Crypto.** AES-256-GCM envelope encryption, applied as a stream. Each blob gets a random
  256-bit data key (DEK), wrapped by the active KEK; the stored object is a self-describing
  `FACILIS1` header (version 1, key id, 1 MiB chunk size, wrap nonce, wrapped DEK) followed by
  the chunks, each with its own nonce and tag. There is no plaintext length and no chunk count
  in the header: each chunk's AAD binds the full header, the chunk index and a final-chunk
  flag, the KEK wrap authenticates the header prefix, and holding one chunk back is what marks
  the last one. Editing the key id, reordering chunks, truncating the body or appending bytes
  all fail authentication, and the encryptor never needs the size up front.
  `encryptStream`/`decryptStream` and `createEncryptedStorage({ driver, keys })` in
  `@facilis.dev/storage` do this while streaming: the encryptor holds one 1 MiB plaintext
  chunk, and the decryptor keeps up to two ciphertext frames (about 2 MiB) in flight to
  establish whether the last chunk is final.
- **Streaming.** Bytes are async iterables at every layer: `StorageDriver.put` takes a
  `BlobSource` and hashes (and encrypts) while writing, and `get` validates the hash and
  returns a `BlobSource`; `@facilis.dev/core` mirrors that as `StorageStream`. The local driver
  writes to a temp file and renames the finished blob into place. An S3 PUT must know the
  payload hash and length for SigV4, so the driver stages the upload stream (ciphertext when
  encryption is on) to a `0600` temp file while hashing and counting it, uploads from that file
  and deletes it.
  `sendStoredFile` returns the plaintext stream as the response body, with `content-length`
  taken from `facilis_files.size` (the plaintext size). One qualification keeps that honest:
  the platform multipart parser (`request.formData()`) materializes the uploaded form once,
  bounded by `maxUploadBytes` (default 10 MiB, hard cap 100 MiB), before the file is streamed
  into storage — uploading is not zero-copy for the whole request, only the framework's
  storage/crypto path is.
- **Content addressing.** The content hash is sha-256 of the **stored** bytes — ciphertext in
  encrypted mode. Equal plaintexts therefore produce different blobs and different hashes,
  which deliberately disables cross-upload dedupe (and stops the store revealing equality);
  `facilis_files.size` and `maxUploadBytes` stay the plaintext size, because the metadata
  describes the user's file.
- **Downloads.** An encrypted deployment has no S3 presigned redirect: the bucket holds only
  ciphertext, so handing a browser a bucket URL would serve ciphertext. The wrapper exposes no
  `signedGetUrl`, so `sendStoredFile` always proxies through the app and decrypts while
  streaming, with the response size taken from the metadata row. S3 server-side encryption
  (SSE-S3/SSE-KMS) is orthogonal and can be layered underneath: it protects the bucket, while
  this layer protects a copied body or a reader of the bucket.
- **Rotation and enabling it later.** Rotation is: make a new key active and move the old key
  into `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS`. Every blob names the key that wrapped its
  DEK, so a retired key keeps decrypting old blobs while new uploads use the active one.
  Enabling encryption on a project that already holds plaintext blobs refuses those blobs
  (the decrypt stream sees no `FACILIS1` magic and the first read throws, so the download fails
  instead of ever returning plaintext) — they must be re-uploaded. There is no online
  re-encryption and no GC: D-053/D-116's immutable-body and no-sweeper rules are unchanged.

**Consequences.** Plaintext projects are unchanged byte-for-byte (default off: same hashes,
dedupe and presign path), so D-053 and D-116 keep their contracts. An encrypted deployment
loses cross-upload dedupe — storage grows with uploads, not distinct content — pays per-blob
crypto overhead and proxies every download through the app instead of redirecting to S3. Both
modes stream: the download size header comes from the metadata row, and an S3 upload trades a
bounded temp-file staging step (disk, up to `maxUploadBytes`) for a signed payload. The
platform's multipart parser still materializes the upload form once before the stream starts.
The stored hash is a ciphertext address, not a plaintext one, so tooling must not use it to
detect equal content.

**Verification.** `packages/storage/src/encryption.test.ts` pins the stream: empty, one-byte,
chunk-boundary and multi-chunk round-trips; independence from how the source and stored blob
are chunked; the self-describing header and key id; no plaintext and no repeated ciphertext;
failure on an unknown/wrong/short key, a flipped ciphertext byte, an edited header, truncation
and a plaintext legacy blob; and rotation with a retired key. `encrypted.test.ts` pins the
wrapper: streamed ciphertext, plaintext size returned, dedupe disabled (equal plaintexts
become distinct hashes) and no `signedGetUrl`. `s3.test.ts` pins the streamed PUT (SigV4
payload hash, temp-file staging) and GET. `@facilis.dev/nitro`'s `storage-encrypted.test.ts`
uploads a multipart file through encryption and downloads it byte-for-byte with a plaintext
`content-length`; `storage-target.test.ts` pins the two key warnings and the absent presign;
`@facilis.dev/core`'s config suite pins the strict `encryption` section; the D-053/D-116 plaintext
suites stay green.
