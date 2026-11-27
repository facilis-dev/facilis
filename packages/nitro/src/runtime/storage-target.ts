import { randomBytes } from "node:crypto";
import { join } from "node:path";

import {
  DEFAULT_STORAGE_CONFIG,
  type FacilisConfig,
  type FacilisRuntimeConfig,
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
import { runtimeSecret } from "./runtime-values.ts";
import { resolveEncryptionKeys } from "./storage-keys.ts";
import {
  resolveStorageTarget,
  type EffectiveStorageConfig,
} from "./storage-target-config.ts";

/**
 * Resolve the binary-storage runtime from the config + resolved runtime section (D-053, D-224).
 *
 * The runtime section, not the build-time storage config, holds credentials and the token
 * secret, so the committed facilis.config.ts never carries a secret. Every refusal is a warning
 * and yields a null storage: the app keeps booting and only the file routes answer
 * `storage_unavailable`, exactly like the database target (D-068).
 */
export interface ResolvedStorage {
  readonly storage: StorageApi | null;
  readonly warnings: readonly ManifestWarning[];
}

export interface ResolveStorageDeps {
  /** Test seam: build the low-level driver without touching the filesystem or the network. */
  readonly createDriver?: (config: EffectiveStorageConfig, rootDir: string) => StorageDriver;
  /** Test seam: the HMAC secret (defaults to FACILIS_STORAGE_SECRET / a per-boot random). */
  readonly secret?: string;
  /** Test seam: the dev fallback secret. */
  readonly randomSecret?: () => string;
  /** Test seam: skip the environment and use this key ring (D-117). */
  readonly encryptionKeys?: StorageEncryptionKeys;
}

const LOCAL_ROOT = join(".facilis", "binary");

export function resolveStorage(
  config: FacilisConfig | null,
  runtime: FacilisRuntimeConfig,
  env: NodeJS.ProcessEnv,
  projectRoot: string,
  deps: ResolveStorageDeps = {},
): ResolvedStorage {
  const production = isProductionEnvironment(env);
  const target = resolveStorageTarget(runtime);
  if (target.target === null) return { storage: null, warnings: target.warnings };
  const storageConfig: EffectiveStorageConfig = {
    ...(config?.storage ?? DEFAULT_STORAGE_CONFIG),
    ...target.target,
  };
  const warnings: ManifestWarning[] = [];

  if (storageConfig.driver === "local" && production) {
    return {
      storage: null,
      warnings: [
        warning(
          "storage_local_in_production",
          'Production refuses the local file driver: set runtime.storageDriver to "s3" (FACILIS_STORAGE_DRIVER) and an S3-compatible bucket.',
        ),
      ],
    };
  }

  if (
    storageConfig.driver === "s3" &&
    (runtimeSecret(runtime, "s3AccessKeyId") === null ||
      runtimeSecret(runtime, "s3SecretAccessKey") === null)
  ) {
    return {
      storage: null,
      warnings: [
        warning(
          "storage_s3_credentials_missing",
          "S3 storage needs runtime.s3AccessKeyId and runtime.s3SecretAccessKey; set FACILIS_S3_ACCESS_KEY_ID and FACILIS_S3_SECRET_ACCESS_KEY.",
        ),
      ],
    };
  }

  const secret = readSecret(runtime, deps, production);
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
      const resolved = resolveEncryptionKeys(runtime);
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
      createDriver(storageConfig, runtime, projectRoot);
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
  config: EffectiveStorageConfig,
  runtime: FacilisRuntimeConfig,
  projectRoot: string,
): StorageDriver {
  if (config.driver === "local") {
    return createLocalStorage({ rootDir: join(projectRoot, LOCAL_ROOT) });
  }
  const accessKeyId = runtimeSecret(runtime, "s3AccessKeyId");
  const secretAccessKey = runtimeSecret(runtime, "s3SecretAccessKey");
  // The resolver already refuses a target without bucket/region; the guard keeps a hand-built
  // target from reaching the driver with nulls.
  if (
    config.bucket === null ||
    config.region === null ||
    accessKeyId === null ||
    secretAccessKey === null
  ) {
    throw new Error(
      "S3 storage requires runtime.s3Bucket, runtime.s3Region, FACILIS_S3_ACCESS_KEY_ID and FACILIS_S3_SECRET_ACCESS_KEY",
    );
  }
  const sessionToken = runtimeSecret(runtime, "s3SessionToken");
  return createS3Storage({
    bucket: config.bucket,
    region: config.region,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken === null ? {} : { sessionToken }),
    ...(config.endpoint === null ? {} : { endpoint: config.endpoint }),
    ...(config.forcePathStyle === null ? {} : { forcePathStyle: config.forcePathStyle }),
  });
}

function createStorageApi(
  driver: StorageDriver,
  secret: string,
  config: EffectiveStorageConfig,
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

function readSecret(
  runtime: FacilisRuntimeConfig,
  deps: ResolveStorageDeps,
  production: boolean,
): string | null {
  if (deps.secret !== undefined) return deps.secret.length === 0 ? null : deps.secret;
  const fromRuntime = runtimeSecret(runtime, "storageSecret")?.trim();
  if (fromRuntime !== undefined && fromRuntime.length > 0) return fromRuntime;
  if (production) return null;
  // Dev tokens only need to live for the boot (five-minute TTL); a per-boot secret keeps
  // the zero-config dev path working without writing a secret to the project.
  return (deps.randomSecret ?? (() => randomBytes(32).toString("hex")))();
}

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
