import type { FacilisStorageConfig } from "./config.ts";

/**
 * The server-side storage surface a route context carries (D-053, SPEC §5.10).
 *
 * Core declares the contract so the handler types never depend on the Node-only
 * @facilis.dev/storage package: @facilis.dev/nitro implements it over a local or S3-compatible
 * driver, exactly like JobsApi is declared here and implemented by the queue runtime.
 * Access control is not the storage's job: the app's routes decide who may read a blob and
 * build a short-lived signed URL (buildDownloadUrl).
 *
 * Bytes stream in both directions (D-117): a route hands the multipart file stream to
 * storeUpload, and the download helper turns the returned stream into the Response body.
 */
export interface StoragePutResult {
  readonly hash: string;
  readonly size: number;
}

/** A stream of blob bytes: uploads enter and downloads leave as one. */
export type StorageStream = AsyncIterable<Uint8Array>;

export interface StorageDownloadOptions {
  readonly tenantId?: string;
  readonly subject?: string;
  readonly expiresInSeconds?: number;
}

export interface StorageTokenPayload {
  readonly fileId: string;
  readonly tenantId?: string;
  readonly subject?: string;
  /** Expiry as epoch milliseconds. */
  readonly expiresAt: number;
}

export interface StoragePresignOptions {
  readonly expiresInSeconds?: number;
  readonly responseName?: string;
}

export interface StorageApi {
  /** "local" in dev, "s3" in production; "none" is the unavailable fallback. */
  readonly kind: FacilisStorageConfig["driver"] | "none";
  /** False when the boot could not configure a driver; routes must degrade, not crash. */
  readonly available: boolean;
  /** Upload limit from facilis.config.ts (storage.maxUploadBytes). */
  readonly maxUploadBytes: number;
  /** Stream the bytes into storage; the returned size is the plaintext size. */
  put(source: StorageStream): Promise<StoragePutResult>;
  /** Validate the hash now; the bytes arrive when the returned stream is consumed. */
  get(hash: string): Promise<StorageStream>;
  exists(hash: string): Promise<boolean>;
  delete(hash: string): Promise<void>;
  /** App-relative URL (/api/files/<id>?token=…) a browser can fetch without a cookie. */
  buildDownloadUrl(fileId: string, options?: StorageDownloadOptions): string;
  /** Verify a token and require it to address fileId; null for anything invalid. */
  verifyDownloadToken(token: string, fileId: string): StorageTokenPayload | null;
  /** A driver-presigned S3 GET, when the driver supports it (production redirect path). */
  presignedGetUrl?(hash: string, options?: StoragePresignOptions): Promise<string>;
}

export class StorageUnavailableError extends Error {
  readonly code = "storage_unavailable";

  constructor(message = "The binary-storage runtime is not available.") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

/**
 * The API a route context carries when storage failed to boot (mirror of unavailableJobs).
 *
 * The request must keep working for the rest of the app: only the file routes see the
 * failure, and they turn it into the storage_unavailable error code.
 */
export function unavailableStorage(): StorageApi {
  const reject = async (): Promise<never> => {
    throw new StorageUnavailableError();
  };
  return {
    kind: "none",
    available: false,
    maxUploadBytes: 0,
    put: reject,
    get: reject,
    exists: reject,
    delete: reject,
    buildDownloadUrl: () => "",
    verifyDownloadToken: () => null,
  };
}
