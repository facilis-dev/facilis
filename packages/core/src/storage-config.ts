import { z } from "zod";

/**
 * Binary storage configuration (D-053/D-117, SPEC §5.10), split from `config.ts` to keep
 * each module under the 300-line limit. The section carries only non-secret values:
 * credentials, the download-token secret and the encryption key come from the environment.
 */

/** Binary-storage drivers supported by `@facilis.dev/storage`. */
export const STORAGE_DRIVERS = ["local", "s3"] as const;
export type StorageDriverKind = (typeof STORAGE_DRIVERS)[number];

/** Upload limit cap: a generated app may lower it, never exceed 100 MiB. */
const MAX_UPLOAD_BYTES_CAP = 100 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_TOKEN_TTL_SECONDS = 300;
const MAX_TOKEN_TTL_SECONDS = 60 * 60 * 24;

/**
 * At-rest encryption toggle (D-117). Only the switch lives in config: the key material
 * (the active key, its id and any retired rotation keys) comes from the environment.
 */
export interface FacilisStorageEncryptionConfig {
  readonly enabled: boolean;
}

/**
 * Binary storage for files uploaded by the app (D-053, D-117, SPEC §5.10).
 *
 * Credentials, the token secret and the encryption key come from the environment
 * (FACILIS_S3_ACCESS_KEY_ID / FACILIS_S3_SECRET_ACCESS_KEY / FACILIS_S3_SESSION_TOKEN /
 * FACILIS_STORAGE_SECRET / FACILIS_STORAGE_ENCRYPTION_KEY), so a committed config never
 * contains a secret. `bucket` and `region` are required with the "s3" driver and
 * validated by the config schema.
 */
export interface FacilisStorageConfig {
  readonly driver: StorageDriverKind;
  readonly bucket: string | null;
  readonly region: string | null;
  /** S3-compatible endpoint (R2, MinIO); null means AWS S3. */
  readonly endpoint: string | null;
  /** null lets the driver decide: path style with a custom endpoint, virtual-hosted on AWS. */
  readonly forcePathStyle: boolean | null;
  readonly maxUploadBytes: number;
  readonly tokenTtlSeconds: number;
  /** Optional AES-256-GCM encryption of the stored bytes (D-117). */
  readonly encryption: FacilisStorageEncryptionConfig;
}

/** Authored form of the storage section: every key has a documented default. */
export interface FacilisStorageConfigInput {
  readonly driver?: StorageDriverKind;
  readonly bucket?: string | null;
  readonly region?: string | null;
  readonly endpoint?: string | null;
  readonly forcePathStyle?: boolean | null;
  readonly maxUploadBytes?: number;
  readonly tokenTtlSeconds?: number;
  readonly encryption?: { readonly enabled?: boolean };
}

const DEFAULT_ENCRYPTION_CONFIG: FacilisStorageEncryptionConfig = Object.freeze({
  enabled: false,
});

/** Defaults a project gets without declaring the section: local dev storage, no encryption. */
export const DEFAULT_STORAGE_CONFIG: FacilisStorageConfig = Object.freeze({
  driver: "local",
  bucket: null,
  region: null,
  endpoint: null,
  forcePathStyle: null,
  maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  tokenTtlSeconds: DEFAULT_TOKEN_TTL_SECONDS,
  encryption: DEFAULT_ENCRYPTION_CONFIG,
});

const encryptionSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
  })
  .default(() => ({ ...DEFAULT_ENCRYPTION_CONFIG }));

export const facilisStorageConfigSchema = z
  .strictObject({
    driver: z.enum(STORAGE_DRIVERS).default("local"),
    bucket: z.string().min(1).nullable().default(null),
    region: z.string().min(1).nullable().default(null),
    endpoint: z.string().min(1).nullable().default(null),
    forcePathStyle: z.boolean().nullable().default(null),
    maxUploadBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES_CAP)
      .default(DEFAULT_MAX_UPLOAD_BYTES),
    tokenTtlSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOKEN_TTL_SECONDS)
      .default(DEFAULT_TOKEN_TTL_SECONDS),
    encryption: encryptionSchema,
  })
  .default(() => ({ ...DEFAULT_STORAGE_CONFIG }));
