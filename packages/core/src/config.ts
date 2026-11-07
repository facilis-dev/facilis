import { z } from "zod";

import {
  facilisJobsConfigSchema,
  type FacilisJobsConfig,
  type FacilisJobsConfigInput,
} from "./jobs-config.ts";

export { DEFAULT_JOBS_CONFIG, facilisJobsConfigSchema } from "./jobs-config.ts";
export type { FacilisJobsConfig, FacilisJobsConfigInput } from "./jobs-config.ts";

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
  /** Background-job queue settings (D-102, docs/JOBS.md §4). */
  readonly jobs: FacilisJobsConfig;
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
  };
  /** Background-job queue settings; every key has a default (D-102). */
  readonly jobs?: FacilisJobsConfigInput;
}

/**
 * Permissions are stable identifiers: a role may only reference permissions declared in
 * `auth.permissions`, and the wildcard is a role-only shorthand (SPEC §8.4.1).
 */
const WILDCARD_PERMISSION = "*";
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
});

const baseConfigSchema = z.strictObject({
  release: releaseSchema,
  db: dbSchema,
  i18n: i18nSchema,
  blocks: blocksSchema,
  auth: authSchema,
  jobs: facilisJobsConfigSchema,
  nitro: nitroSchema,
});

type ConfigPath = readonly (string | number)[];

function addIssue(ctx: z.RefinementCtx, path: ConfigPath, message: string): void {
  ctx.addIssue({ code: "custom", message, path: [...path] });
}

function reportDuplicates(
  values: readonly string[],
  path: ConfigPath,
  ctx: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) addIssue(ctx, [...path, index], `duplicate ${label} "${value}"`);
    seen.add(value);
  }
}

function ownRole(config: FacilisConfig, role: string): readonly string[] | undefined {
  // A record from JSON can inherit Object.prototype keys, so membership must be own-only.
  return Object.hasOwn(config.auth.roles, role) ? config.auth.roles[role] : undefined;
}

function crossCheck(config: FacilisConfig, ctx: z.RefinementCtx): void {
  const declared = new Set(config.auth.permissions);

  if (declared.has(WILDCARD_PERMISSION)) {
    addIssue(
      ctx,
      ["auth", "permissions"],
      `"${WILDCARD_PERMISSION}" is only valid inside auth.roles; declare permissions explicitly`,
    );
  }
  reportDuplicates(config.auth.permissions, ["auth", "permissions"], ctx, "permission");

  for (const [role, permissions] of Object.entries(config.auth.roles)) {
    const seen = new Set<string>();
    for (const [index, permission] of permissions.entries()) {
      if (permission === WILDCARD_PERMISSION) continue;
      if (!declared.has(permission)) {
        addIssue(
          ctx,
          ["auth", "roles", role, index],
          `role "${role}" references unknown permission "${permission}"; declare it in auth.permissions`,
        );
      }
      if (seen.has(permission)) {
        addIssue(ctx, ["auth", "roles", role, index], `role "${role}" repeats "${permission}"`);
      }
      seen.add(permission);
    }
  }

  if (ownRole(config, config.auth.defaultRole) === undefined) {
    addIssue(
      ctx,
      ["auth", "defaultRole"],
      `defaultRole "${config.auth.defaultRole}" is not a key of auth.roles`,
    );
  }

  if (!config.i18n.locales.includes(config.i18n.defaultLocale)) {
    addIssue(
      ctx,
      ["i18n", "defaultLocale"],
      `defaultLocale "${config.i18n.defaultLocale}" must be listed in i18n.locales`,
    );
  }
}

/**
 * Zod schema for the complete `FacilisConfig` shape.
 *
 * Sections other than `auth` have documented defaults so a generated project can grow into
 * them; the auth block is always explicit and cross-checked (SPEC §8.4.1).
 */
export const facilisConfigSchema = baseConfigSchema.superRefine(crossCheck);

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
