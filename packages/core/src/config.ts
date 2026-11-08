import { z } from "zod";

import {
  facilisJobsConfigSchema,
  type FacilisJobsConfig,
  type FacilisJobsConfigInput,
} from "./jobs-config.ts";
import {
  facilisLoggingConfigSchema,
  type FacilisLoggingConfig,
  type FacilisLoggingConfigInput,
} from "./logging-config.ts";
import {
  ssoConfigSchema,
  type FacilisSsoConfig,
  type FacilisSsoConfigInput,
} from "./sso-config.ts";
import { crossCheckConfig } from "./config-validation.ts";
import {
  facilisStorageConfigSchema,
  type FacilisStorageConfig,
  type FacilisStorageConfigInput,
} from "./storage-config.ts";

export { DEFAULT_LOGGING_CONFIG, facilisLoggingConfigSchema } from "./logging-config.ts";
export type { FacilisLoggingConfig, FacilisLoggingConfigInput } from "./logging-config.ts";
export {
  DEFAULT_SSO_CONFIG,
  SSO_PROVIDER_KINDS,
  ssoConfigSchema,
  ssoProviderSchema,
} from "./sso-config.ts";
export type {
  FacilisSsoConfig,
  FacilisSsoConfigInput,
  FacilisSsoProvider,
  SsoProviderKind,
} from "./sso-config.ts";
export { DEFAULT_JOBS_CONFIG, facilisJobsConfigSchema } from "./jobs-config.ts";
export type { FacilisJobsConfig, FacilisJobsConfigInput } from "./jobs-config.ts";
export { DEFAULT_STORAGE_CONFIG, STORAGE_DRIVERS } from "./storage-config.ts";
export type {
  FacilisStorageConfig,
  FacilisStorageConfigInput,
  FacilisStorageEncryptionConfig,
  StorageDriverKind,
} from "./storage-config.ts";

/**
 * The configuration contract of a Facilis project (SPEC §7.1).
 *
 * Everything here is declared in the project's `facilis.config.ts` and is therefore code:
 * reviewable, diffable and the only source of truth for roles and permissions (SPEC §8.4.1).
 */

/** Database driver modes supported by `@facilis/db` (SPEC §7.1). */
export const DB_MODES = ["pglite", "postgres", "json"] as const;
export type DbMode = (typeof DB_MODES)[number];

export interface FacilisReleaseConfig {
  readonly ref: string;
}

export interface FacilisDbConfig {
  readonly mode: DbMode;
  readonly migrationsDir: string;
  readonly tenantColumns: readonly string[];
  readonly ownerColumns: readonly string[];
}

export interface FacilisI18nConfig {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

export interface FacilisBlocksConfig {
  readonly packages: readonly string[];
}

export interface FacilisAuthConfig {
  readonly permissions: readonly string[];
  /** Role name → permission names. `"*"` is only valid here, as "every declared permission". */
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly defaultRole: string;
  readonly sessionDurationMs: number;
  /** External identity providers (D-120); `providers: []` when the app uses passwords only. */
  readonly sso: FacilisSsoConfig;
}

/**
 * Nitro options owned by the project (D-034).
 *
 * Facilis validates only the shape — an object — and passes every key to Nitro untouched:
 * these are Nitro's options, not the framework's. `@facilis/nitro` merges them over the
 * Facilis defaults (`serverDir: "./server"`, `experimental.openAPI: true`), so a project
 * only declares what it changes.
 */
export type FacilisNitroOptions = Readonly<Record<string, unknown>>;

export interface FacilisConfig {
  readonly release: FacilisReleaseConfig;
  readonly db: FacilisDbConfig;
  readonly i18n: FacilisI18nConfig;
  readonly blocks: FacilisBlocksConfig;
  readonly auth: FacilisAuthConfig;
  /** Background-job queue settings (D-107, docs/JOBS.md §4). */
  readonly jobs: FacilisJobsConfig;
  /** Binary uploads (D-053): driver, bucket and the framework limits. */
  readonly storage: FacilisStorageConfig;
  /** Operator logging defaults (D-119): level and what is collected; sinks are env-owned. */
  readonly logging: FacilisLoggingConfig;
  readonly nitro: FacilisNitroOptions;
}

/**
 * Authored form of the config: everything has a default except the auth declaration, and
 * arrays are readonly so a fully-typed `FacilisConfig` can be passed back in unchanged.
 */
export interface FacilisConfigInput {
  readonly release?: { readonly ref?: string };
  readonly db?: {
    readonly mode?: DbMode;
    readonly migrationsDir?: string;
    readonly tenantColumns?: readonly string[];
    readonly ownerColumns?: readonly string[];
  };
  readonly i18n?: { readonly defaultLocale?: string; readonly locales?: readonly string[] };
  readonly blocks?: { readonly packages?: readonly string[] };
  /** Passed to Nitro unchanged; `@facilis/nitro` merges the framework defaults underneath. */
  readonly nitro?: FacilisNitroOptions;
  readonly auth: {
    readonly permissions?: readonly string[];
    readonly roles?: Readonly<Record<string, readonly string[]>>;
    readonly defaultRole: string;
    readonly sessionDurationMs?: number;
    /** External identity providers (D-120); every key has a default. */
    readonly sso?: FacilisSsoConfigInput;
  };
  /** Background-job queue settings; every key has a default (D-107). */
  readonly jobs?: FacilisJobsConfigInput;
  /** Binary uploads (D-053, D-117); every key has a default. */
  readonly storage?: FacilisStorageConfigInput;
  /** Logging defaults (D-119); every key has a default and the environment overrides them. */
  readonly logging?: FacilisLoggingConfigInput;
}

const DEFAULT_RELEASE_REF = "main";
const DEFAULT_MIGRATIONS_DIR = "./drizzle";
const DEFAULT_TENANT_COLUMN = "tenantId";
const DEFAULT_OWNER_COLUMN = "ownerId";
const DEFAULT_LOCALE = "en";
const DEFAULT_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

const DEFAULT_DB_CONFIG = {
  mode: "pglite" as const,
  migrationsDir: DEFAULT_MIGRATIONS_DIR,
  tenantColumns: [DEFAULT_TENANT_COLUMN],
  ownerColumns: [DEFAULT_OWNER_COLUMN],
};

const DEFAULT_I18N_CONFIG = { defaultLocale: DEFAULT_LOCALE, locales: [DEFAULT_LOCALE] };

const DEFAULT_BLOCKS_CONFIG = { packages: [] as string[] };

const releaseSchema = z
  .strictObject({
    ref: z.string().min(1, "release.ref must be a non-empty git ref"),
  })
  // A generated project boots against its own branch; `main` is the least surprising default.
  .default({ ref: DEFAULT_RELEASE_REF });

const dbSchema = z
  .strictObject({
    mode: z.enum(DB_MODES).default("pglite"),
    migrationsDir: z.string().min(1).default(DEFAULT_MIGRATIONS_DIR),
    tenantColumns: z.array(z.string().min(1)).default([DEFAULT_TENANT_COLUMN]),
    ownerColumns: z.array(z.string().min(1)).default([DEFAULT_OWNER_COLUMN]),
  })
  .default(() => DEFAULT_DB_CONFIG);

const i18nSchema = z
  .strictObject({
    defaultLocale: z.string().min(1).default(DEFAULT_LOCALE),
    locales: z.array(z.string().min(1)).default([DEFAULT_LOCALE]),
  })
  .default(() => DEFAULT_I18N_CONFIG);

const blocksSchema = z
  .strictObject({
    packages: z.array(z.string().min(1)).default([]),
  })
  .default(() => DEFAULT_BLOCKS_CONFIG);

// Nitro's own options are not Facilis's contract, so the section is a pass-through: keep
// the object as authored and let @facilis/nitro apply the framework defaults underneath.
const nitroSchema = z.record(z.string(), z.unknown()).default({});

// Session duration is a safe default (one week, matching SPEC §8.4.1's example); everything
// security-relevant (roles, permissions, default role) stays required so it is never implicit.
const authSchema = z.strictObject({
  permissions: z.array(z.string().min(1)).default([]),
  roles: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
  defaultRole: z.string().min(1),
  sessionDurationMs: z.number().int().positive().default(DEFAULT_SESSION_DURATION_MS),
  sso: ssoConfigSchema,
});

const baseConfigSchema = z.strictObject({
  release: releaseSchema,
  db: dbSchema,
  i18n: i18nSchema,
  blocks: blocksSchema,
  auth: authSchema,
  jobs: facilisJobsConfigSchema,
  storage: facilisStorageConfigSchema,
  logging: facilisLoggingConfigSchema,
  nitro: nitroSchema,
});

/**
 * Zod schema for the complete `FacilisConfig` shape.
 *
 * Sections other than `auth` have documented defaults so a generated project can grow into
 * them; the auth block is always explicit and cross-checked (SPEC §8.4.1).
 */
export const facilisConfigSchema = baseConfigSchema.superRefine(crossCheckConfig);

/**
 * Validates `facilis.config.ts` and returns the resolved, full config.
 *
 * Throws a readable error instead of returning a partially valid contract: a project with
 * unknown role permissions must fail at boot (SPEC §8.4.1), not on the first request.
 */
export function defineConfig(config: FacilisConfigInput): FacilisConfig {
  const result = facilisConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid facilis config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
