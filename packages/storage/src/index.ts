/**
 * @facilis/storage: content-addressed binary storage.
 *
 * Dev: createLocalStorage({ rootDir: "<project>/.facilis/binary" }) (project filesystem/VFS).
 * Prod: createS3Storage(...) for any S3-compatible store (AWS S3, Cloudflare R2, MinIO).
 *
 * Everything streams (D-117): put takes an AsyncIterable and hashes while it writes; get
 * returns an AsyncIterable. Access is decided by the app's proxy route: it verifies a
 * signed download token (signing.ts) and then streams the blob or redirects to a
 * driver-presigned URL.
 *
 * At-rest encryption is an opt-in driver wrapper (D-117): createEncryptedStorage({ driver,
 * keys }) encrypts while streaming. The wrapper removes signedGetUrl on purpose, so an
 * encrypted deployment always proxies the download.
 */
export { contentHash, isContentHash } from "./hash.ts";
export { createEncryptedStorage, type EncryptedStorageOptions } from "./encrypted.ts";
export {
  decryptStream,
  encryptStream,
  isEncryptedBlob,
  isValidEncryptionKeyId,
  openEncryptedStream,
  STORAGE_ENCRYPTION_CHUNK_BYTES,
  type StorageEncryptionKeys,
} from "./encryption.ts";
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
  type BlobSource,
  type PutResult,
  type SignedGetUrlOptions,
  type SigningStorageDriver,
  type StorageDriver,
} from "./types.ts";
