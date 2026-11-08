import { z } from "zod";

import type { FacilisConfig } from "./config.ts";
import { checkSsoConfig } from "./sso-config.ts";

/**
 * Cross-section validation for `facilis.config.ts` (SPEC §7.1, §8.4.1).
 *
 * The per-section Zod schemas only see their own object; these checks need the whole config
 * (a role names a declared permission, SSO names an existing role, S3 names its bucket). They
 * live here so `config.ts` stays under the 300-line limit and so the auth/storage/SSO rules
 * have one reviewable home.
 */

/**
 * Permissions are stable identifiers: a role may only reference permissions declared in
 * `auth.permissions`, and the wildcard is a role-only shorthand (SPEC §8.4.1).
 */
const WILDCARD_PERMISSION = "*";

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

/** Refinement run by `facilisConfigSchema`: every cross-section rule in one place. */
export function crossCheckConfig(config: FacilisConfig, ctx: z.RefinementCtx): void {
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

  if (config.storage.driver === "s3") {
    if (config.storage.bucket === null) {
      addIssue(
        ctx,
        ["storage", "bucket"],
        'storage.bucket is required when storage.driver is "s3"',
      );
    }
    if (config.storage.region === null) {
      addIssue(
        ctx,
        ["storage", "region"],
        'storage.region is required when storage.driver is "s3"',
      );
    }
  }

  if (!config.i18n.locales.includes(config.i18n.defaultLocale)) {
    addIssue(
      ctx,
      ["i18n", "defaultLocale"],
      `defaultLocale "${config.i18n.defaultLocale}" must be listed in i18n.locales`,
    );
  }

  // SSO provider ids are URL segments and their roles must exist in auth.roles (D-120).
  checkSsoConfig(config.auth.sso, config.auth, ctx);
}
