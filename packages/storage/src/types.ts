/** Result of storing a blob. Identical bytes always return the same hash. */
export interface PutResult {
  readonly hash: string;
  readonly size: number;
}

/**
 * A stream of blob bytes. This is the only way bytes enter or leave a driver: uploads
 * arrive as an async iterable (the multipart file stream) and downloads leave as one, so no
 * layer has to hold a whole file in memory (D-117).
 */
export type BlobSource = AsyncIterable<Uint8Array>;

export interface SignedGetUrlOptions {
  /** Lifetime of the URL. Defaults to five minutes. */
  readonly expiresInSeconds?: number;
  /** content-disposition filename a browser should download the blob as. */
  readonly responseName?: string;
}

/**
 * A content-addressed binary store.
 *
 * put is idempotent: storing the same bytes twice returns the same hash and does not
 * duplicate the body. There is no rename/update: a different body is a different blob.
 * put and get stream: the driver hashes/encrypts while it writes and yields while it reads.
 *
 * Access control is NOT the driver's job. The app's proxy route decides who may read a
 * blob and then either streams it (get) or redirects to a driver-signed URL
 * (signedGetUrl, S3-compatible drivers only). Neither driver exposes the store root.
 */
export interface StorageDriver {
  /** "local" (dev, project filesystem) or "s3" (AWS S3, Cloudflare R2, MinIO). */
  readonly driver: "local" | "s3";
  put(source: BlobSource): Promise<PutResult>;
  /** Validate the hash now; the bytes arrive only when the returned source is consumed. */
  get(hash: string): Promise<BlobSource>;
  exists(hash: string): Promise<boolean>;
  /** Delete the body. No-op when it is already gone (metadata may outlive it). */
  delete(hash: string): Promise<void>;
}

/** A driver that can issue time-limited direct-download URLs (S3-compatible stores). */
export interface SigningStorageDriver extends StorageDriver {
  signedGetUrl(hash: string, options?: SignedGetUrlOptions): Promise<string>;
}

export class StorageError extends Error {
  readonly code = "storage_error";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}
