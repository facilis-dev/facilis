/**
 * @facilis/storage: content-addressed binary storage.
 *
 * Dev: createLocalStorage({ rootDir: "<project>/.facilis/binary" }) (project filesystem/VFS).
 * Prod: createS3Storage(...) for any S3-compatible store (AWS S3, Cloudflare R2, MinIO).
 *
 * Access is decided by the app's proxy route: it verifies a signed download token
 * (signing.ts) and then streams the blob or redirects to a driver-presigned URL.
 */
export { contentHash, isContentHash } from "./hash.ts";
export { createLocalStorage, type LocalStorageOptions } from "./local.ts";
export { createS3Storage, type S3StorageOptions } from "./s3.ts";
export {
  buildSignedDownloadUrl,
  signDownloadToken,
  verifyDownloadToken,
  type FileTokenPayload,
} from "./signing.ts";
export {
  StorageError,
  type PutResult,
  type SignedGetUrlOptions,
  type SigningStorageDriver,
  type StorageDriver,
} from "./types.ts";
