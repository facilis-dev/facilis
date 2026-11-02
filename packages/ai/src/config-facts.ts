/**
 * Parsing of `facilis.config.ts` (SPEC §7.1) into the facts the validator needs.
 *
 * A generated project declares auth as an object literal inside `defineConfig`, so a
 * tolerant scan of the source is enough and keeps `@facilis/ai` free of a TypeScript
 * parser. When the source is unreadable the manifest's config section is the fallback
 * (see context.ts); a source that parses is always authoritative.
 */

import {
  arrayProperty,
  callsFunction,
  hasProperty,
  maskSource,
  objectProperty,
  stringLiterals,
  stringProperty,
} from "./scan.ts";
import type { ConfigFacts } from "./types.ts";

/** Core defaults (packages/core/src/config.ts), used when a section is absent. */
const DEFAULT_MIGRATIONS_DIR = "db/migrations";
const DEFAULT_TENANT_COLUMNS = ["tenantId", "tenant_id"];
const DEFAULT_OWNER_COLUMNS = ["ownerId", "owner_id", "userId", "user_id"];

export function emptyConfigFacts(overrides: Partial<ConfigFacts> = {}): ConfigFacts {
  return {
    parsed: false,
    hasAuth: false,
    permissions: [],
    roles: {},
    defaultRole: null,
    defaultLocale: null,
    locales: [],
    blocksPackages: [],
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    tenantColumns: DEFAULT_TENANT_COLUMNS,
    ownerColumns: DEFAULT_OWNER_COLUMNS,
    ...overrides,
  };
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) return value.slice(1, -1);
  return value;
}

/** `roles: { admin: ["*"], user: ["todos:read"] }` → role name to permission list. */
function parseRoles(body: string): Record<string, readonly string[]> {
  const roles: Record<string, readonly string[]> = {};
  const pattern = /([A-Za-z_$][\w$]*|"[^"]*"|'[^']*')\s*:\s*\[([^\]]*)\]/g;
  for (const match of body.matchAll(pattern)) {
    const key = match[1];
    const values = match[2];
    if (key === undefined || values === undefined) continue;
    roles[unquote(key)] = stringLiterals(values);
  }
  return roles;
}

function blockPackages(source: string, masked: string): string[] {
  const blocks = objectProperty(source, masked, "blocks");
  if (blocks === null) return [];
  const match = /packages\s*:\s*\[([^\]]*)\]/.exec(blocks);
  return match?.[1] === undefined ? [] : stringLiterals(match[1]);
}

/** Extract the config facts a patch validator can check without executing the module. */
export function parseConfigSource(source: string): ConfigFacts {
  const base = emptyConfigFacts();
  if (source.trim().length === 0) return base;
  const masked = maskSource(source);
  const parsed = callsFunction(masked, "defineConfig") || hasProperty(masked, "auth");
  return {
    parsed,
    hasAuth: hasProperty(masked, "auth"),
    permissions: arrayProperty(source, masked, "permissions") ?? base.permissions,
    roles: parseRoles(objectProperty(source, masked, "roles") ?? ""),
    defaultRole: stringProperty(masked, "defaultRole"),
    defaultLocale: stringProperty(masked, "defaultLocale"),
    locales: arrayProperty(source, masked, "locales") ?? base.locales,
    blocksPackages: blockPackages(source, masked),
    migrationsDir: stringProperty(masked, "migrationsDir") ?? base.migrationsDir,
    tenantColumns: arrayProperty(source, masked, "tenantColumns") ?? base.tenantColumns,
    ownerColumns: arrayProperty(source, masked, "ownerColumns") ?? base.ownerColumns,
  };
}
