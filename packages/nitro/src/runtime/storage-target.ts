import { randomBytes } from "node:crypto";
import { join } from "node:path";

import {
  DEFAULT_STORAGE_CONFIG,
  type FacilisConfig,
  type ManifestWarning,
  type StorageApi,
} from "@facilis.dev/core";
import {
  buildSignedDownloadUrl,
  createEncryptedStorage,
  createLocalStorage,
  createS3Storage,
  verifyDownloadToken,
  type SigningStorageDriver,
  type StorageDriver,
  type StorageEncryptionKeys,
} from "@facilis.dev/storage";

import { isProductionEnvironment } from "./env.ts";
import { resolveEncryptionKeys } from "./storage-keys.ts";

/**
 * Resolve the binary-storage runtime from the project config + environment (D-053).
 *
 * The environment, not the config, holds credentials and the token secret, so the
 * committed facilis.config.ts never carries a secret. Every refusal is a manifest warning
 * and yields a null storage: the app keeps booting and only the file routes answer
 * `storage_unavailable`, exactly like the database target (D-068).
 */
export interface ResolvedStorage {
  readonly storage: StorageApi | null;
  readonly warnings: readonly ManifestWarning[];
}

export interface ResolveStorageDeps {
  /** Test seam: build the low-level driver without touching the filesystem or the network. */
  readonly createDriver?: (config: FacilisConfig["storage"], rootDir: string) => StorageDriver;
  /** Test seam: the HMAC secret (defaults to FACILIS_STORAGE_SECRET / a per-boot random). */
  readonly secret?: string;
  /** Test seam: the dev fallback secret. */
  readonly randomSecret?: () => string;
  /** Test seam: skip the environment and use this key ring (D-117). */
  readonly encryptionKeys?: StorageEncryptionKeys;
}

const SECRET_ENV = "FACILIS_STORAGE_SECRET";
const S3_KEY_ENV = "FACILIS_S3_ACCESS_KEY_ID";
const S3_SECRET_ENV = "FACILIS_S3_SECRET_ACCESS_KEY";
const S3_SESSION_ENV = "FACILIS_S3_SESSION_TOKEN";
const LOCAL_ROOT = join(".facilis", "binary");

export function resolveStorage(
  config: FacilisConfig | null,
  env: NodeJS.ProcessEnv,
  projectRoot: string,
  deps: ResolveStorageDeps = {},
): ResolvedStorage {
  const storageConfig = config?.storage ?? DEFAULT_STORAGE_CONFIG;
  const production = isProductionEnvironment(env);
  const warnings: ManifestWarning[] = [];

  if (storageConfig.driver === "local" && production) {
    return {
      storage: null,
      warnings: [
        warning(
          "storage_local_in_production",
          'Production refuses the local file driver: set storage.driver to "s3" and an S3-compatible bucket.',
        ),
      ],
    };
  }

  if (
    storageConfig.driver === "s3" &&
    (readEnv(env, S3_KEY_ENV) === undefined || readEnv(env, S3_SECRET_ENV) === undefined)
  ) {
    return {
      storage: null,
      warnings: [
        warning(
          "storage_s3_credentials_missing",
          "S3 storage needs FACILIS_S3_ACCESS_KEY_ID and FACILIS_S3_SECRET_ACCESS_KEY.",
        ),
      ],
    };
  }

  const secret = readSecret(env, deps);
  if (secret === null) {
    return {
      storage: null,
      warnings: [
        warning(
          "storage_secret_missing",
          "Set FACILIS_STORAGE_SECRET in production: signed download tokens need a stable secret across restarts and instances.",
        ),
      ],
    };
  }

  let encryptionKeys: StorageEncryptionKeys | null = null;
  if (storageConfig.encryption.enabled) {
    if (deps.encryptionKeys !== undefined) {
      encryptionKeys = deps.encryptionKeys;
    } else {
      const resolved = resolveEncryptionKeys(env);
      if (resolved.keys === null) {
        return {
          storage: null,
          warnings: [
            warning(
              resolved.problem === "missing"
                ? "storage_encryption_key_missing"
                : "storage_encryption_key_invalid",
              resolved.message,
            ),
          ],
        };
      }
      encryptionKeys = resolved.keys;
    }
  }

  try {
    const baseDriver =
      deps.createDriver?.(storageConfig, projectRoot) ??
      createDriver(storageConfig, env, projectRoot);
    const driver =
      encryptionKeys === null
        ? baseDriver
        : createEncryptedStorage({ driver: baseDriver, keys: encryptionKeys });
    return { storage: createStorageApi(driver, secret, storageConfig), warnings };
  } catch (error) {
    return {
      storage: null,
      warnings: [
        warning("storage_boot_failed", `Binary storage could not start: ${describe(error)}`),
      ],
    };
  }
}

function createDriver(
  config: FacilisConfig["storage"],
  env: NodeJS.ProcessEnv,
  projectRoot: string,
): StorageDriver {
  if (config.driver === "local") {
    return createLocalStorage({ rootDir: join(projectRoot, LOCAL_ROOT) });
  }
  const accessKeyId = readEnv(env, S3_KEY_ENV);
  const secretAccessKey = readEnv(env, S3_SECRET_ENV);
  // Config validation already requires bucket/region; the guard keeps a hand-edited or
  // older virtual config from reaching the driver with nulls.
  if (
    config.bucket === null ||
    config.region === null ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    throw new Error(
      "S3 storage requires storage.bucket, storage.region, FACILIS_S3_ACCESS_KEY_ID and FACILIS_S3_SECRET_ACCESS_KEY",
    );
  }
  const sessionToken = readEnv(env, S3_SESSION_ENV);
  return createS3Storage({
    bucket: config.bucket,
    region: config.region,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken === undefined ? {} : { sessionToken }),
    ...(config.endpoint === null ? {} : { endpoint: config.endpoint }),
    ...(config.forcePathStyle === null ? {} : { forcePathStyle: config.forcePathStyle }),
  });
}

function createStorageApi(
  driver: StorageDriver,
  secret: string,
  config: FacilisConfig["storage"],
): StorageApi {
  const signing = isSigningDriver(driver) ? driver : null;
  const api: StorageApi = {
    kind: driver.driver,
    available: true,
    maxUploadBytes: config.maxUploadBytes,
    put: (bytes) => driver.put(bytes),
    get: (hash) => driver.get(hash),
    exists: (hash) => driver.exists(hash),
    delete: (hash) => driver.delete(hash),
    buildDownloadUrl: (fileId, options) =>
      buildSignedDownloadUrl({
        fileId,
        secret,
        expiresInSeconds: options?.expiresInSeconds ?? config.tokenTtlSeconds,
        ...(options?.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options?.subject === undefined ? {} : { subject: options.subject }),
      }),
    verifyDownloadToken: (token, fileId) => {
      const payload = verifyDownloadToken(token, secret);
      return payload === null || payload.fileId !== fileId ? null : payload;
    },
  };
  if (signing !== null) {
    api.presignedGetUrl = (hash, options) => signing.signedGetUrl(hash, options);
  }
  return api;
}

function isSigningDriver(driver: StorageDriver): driver is SigningStorageDriver {
  return typeof (driver as Partial<SigningStorageDriver>).signedGetUrl === "function";
}

function readSecret(env: NodeJS.ProcessEnv, deps: ResolveStorageDeps): string | null {
  if (deps.secret !== undefined) return deps.secret.length === 0 ? null : deps.secret;
  const fromEnv = readEnv(env, SECRET_ENV);
  if (fromEnv !== undefined) return fromEnv;
  if (isProductionEnvironment(env)) return null;
  // Dev tokens only need to live for the boot (five-minute TTL); a per-boot secret keeps
  // the zero-config dev path working without writing a secret to the project.
  return (deps.randomSecret ?? (() => randomBytes(32).toString("hex")))();
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
