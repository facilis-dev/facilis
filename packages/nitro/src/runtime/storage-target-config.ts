import type {
  FacilisConfig,
  FacilisRuntimeConfig,
  ManifestWarning,
  StorageDriverKind,
} from "@facilis.dev/core";

import { runtimeBoolean, runtimeString } from "./runtime-values.ts";

/**
 * The storage target is runtime configuration (D-224), never a build-time section.
 *
 * An absent or invalid key refuses storage with a warning instead of inventing a framework
 * default; the limits and the encryption switch stay in `facilis.config.ts`.
 */
export interface StorageTarget {
  readonly driver: StorageDriverKind;
  readonly bucket: string | null;
  readonly region: string | null;
  readonly endpoint: string | null;
  readonly forcePathStyle: boolean | null;
}

/** Build-time limits plus the runtime target this boot resolved. */
export type EffectiveStorageConfig = StorageTarget & FacilisConfig["storage"];

export interface ResolvedStorageTarget {
  readonly target: StorageTarget | null;
  readonly warnings: readonly ManifestWarning[];
}

export function resolveStorageTarget(runtime: FacilisRuntimeConfig): ResolvedStorageTarget {
  const driver = runtimeString(runtime, "storageDriver");
  if (driver === null) {
    return refused(
      "storage_driver_missing",
      'runtime.storageDriver is not declared; set FACILIS_STORAGE_DRIVER to "local" or "s3".',
    );
  }
  if (driver !== "local" && driver !== "s3") {
    return refused(
      "storage_driver_invalid",
      `runtime.storageDriver "${driver}" is not "local" or "s3"; set FACILIS_STORAGE_DRIVER.`,
    );
  }

  const bucket = runtimeString(runtime, "s3Bucket");
  const region = runtimeString(runtime, "s3Region");
  if (driver === "s3" && bucket === null) {
    return refused(
      "storage_s3_bucket_missing",
      'runtime.storageDriver is "s3" but runtime.s3Bucket is not declared; set FACILIS_S3_BUCKET.',
    );
  }
  if (driver === "s3" && region === null) {
    return refused(
      "storage_s3_region_missing",
      'runtime.storageDriver is "s3" but runtime.s3Region is not declared; set FACILIS_S3_REGION.',
    );
  }

  return {
    target: {
      driver,
      bucket,
      region,
      endpoint: runtimeString(runtime, "s3Endpoint"),
      forcePathStyle: runtimeBoolean(runtime, "s3ForcePathStyle"),
    },
    warnings: [],
  };
}

function refused(code: string, message: string): ResolvedStorageTarget {
  return { target: null, warnings: [{ code, message }] };
}
