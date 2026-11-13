import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/storage` — content-addressed binary storage (D-053, D-117).
 *
 * The driver only stores bytes by hash; the project's proxy route decides access and either
 * streams a blob or redirects to a driver-presigned URL. An opt-in encrypted wrapper drops
 * presigning on purpose, so ciphertext is never served directly.
 */
export const STORAGE_MODULE: FrameworkModule = {
  id: "storage",
  package: "@facilis.dev/storage",
  summary:
    "Streaming content-addressed blobs: local dev and S3-compatible drivers, the encrypted wrapper, hashing and signed download tokens.",
  entries: [
    {
      name: "createLocalStorage",
      kind: "function",
      signature: "createLocalStorage(options: LocalStorageOptions): StorageDriver",
      summary:
        "Dev driver: content-addressed files under .facilis/binary/<hh>/<hash> (the project VFS), streaming put/get, self-ignored for git.",
      example:
        'const storage = createLocalStorage({ rootDir: ".facilis/binary" }); const { hash, size } = await storage.put(stream);',
    },
    {
      name: "createS3Storage",
      kind: "function",
      signature: "createS3Storage(options: S3StorageOptions): SigningStorageDriver",
      summary:
        "Production driver for AWS S3, Cloudflare R2 or MinIO (SigV4 + presigned GET): endpoint/forcePathStyle select R2/MinIO, bucket+region+keys are required.",
    },
    {
      name: "createEncryptedStorage",
      kind: "function",
      signature: "createEncryptedStorage(options: EncryptedStorageOptions): StorageDriver",
      summary:
        "Opt-in at-rest encryption wrapper (createEncryptedStorage({ driver, keys })): encrypts/decrypts while streaming and deliberately removes signedGetUrl.",
    },
    {
      name: "StorageDriver",
      kind: "type",
      signature:
        'interface StorageDriver { driver: "local" | "s3"; put(source: BlobSource): Promise<PutResult>; get(hash: string): Promise<BlobSource>; exists(hash: string): Promise<boolean>; delete(hash: string): Promise<void> }',
      summary:
        "The store contract: put is idempotent, bytes stream both ways, and access control is never the driver's job — the proxy route decides who may read a blob.",
    },
    {
      name: "contentHash",
      kind: "function",
      signature: "contentHash(bytes: Uint8Array): string",
      summary:
        "sha-256 hex content address (lowercase, 64 chars) that every driver keys by; identical bytes are stored once.",
    },
    {
      name: "signDownloadToken",
      kind: "function",
      signature: "signDownloadToken(payload: FileTokenPayload, secret: string): string",
      summary:
        "HMAC-signed download token binding the file id, expiry (epoch ms) and optionally the tenant; a download route can stay public and token-only.",
    },
    {
      name: "verifyDownloadToken",
      kind: "function",
      signature:
        "verifyDownloadToken(token: string, secret: string, now?: number): FileTokenPayload | null",
      summary:
        "Verifies signature first, then expiry; returns null for anything invalid so a route answers not_found without leaking why.",
    },
    {
      name: "buildSignedDownloadUrl",
      kind: "function",
      signature:
        "buildSignedDownloadUrl(input: { fileId: string; secret: string; basePath?: string; expiresInSeconds?: number; tenantId?: string; subject?: string; now?: number }): string",
      summary:
        "Builds the app-relative URL a browser can fetch directly (default /api/files, 5-minute TTL, capped at 24 h).",
    },
  ],
};
