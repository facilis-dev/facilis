/**
 * Virtual module identifiers shared by the Vite plugin (producer) and the Nitro
 * module/runtime (consumers).
 *
 * The Vite plugin owns `#facilis/openapi-meta` because it needs HMR invalidation
 * when a route file changes (SPEC §6.9 consequence); the Nitro module only needs
 * a build-time fallback for the standalone `nitro.config.ts` case.
 */
export const VIRTUAL_CONFIG_ID = "#facilis/config";
export const VIRTUAL_DB_SCHEMA_ID = "#facilis/db-schema";
export const VIRTUAL_OPENAPI_META_ID = "#facilis/openapi-meta";

/** Resolved ids must start with \0 so no on-disk file can shadow them. */
export const RESOLVED_OPENAPI_META_ID = "\0facilis:openapi-meta";
