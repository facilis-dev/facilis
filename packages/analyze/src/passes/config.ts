/**
 * `facilis.config.ts` -> ConfigFacts (docs/findings/ast-dsl-contract.md §3.2).
 *
 * The config is the project's security contract, so a value outside the static subset is an
 * explicit unknown plus a diagnostic, never a silent default. Defaults mirror
 * packages/core/src/config.ts exactly: the runtime and the analyzer must agree on what
 * "absent" means, and only the analyzer may report a wrong value instead of throwing.
 */

import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import { error } from "../diagnostics.ts";
import { defaultExportDeclaration } from "../module-info.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { StaticContext } from "../static-eval.ts";
import type { ConfigFacts, Diagnostic, SourceRef, UnknownFact } from "../types.ts";
import {
  defaultExportExpression,
  isLocallyDeclared,
  isRecord,
  projectPath,
  readStaticObject,
  refOf,
  sortDiagnostics,
  type StaticObject,
} from "./static-read.ts";

const CONFIG_FILE = "facilis.config.ts";
const CORE_SPECIFIER = "@facilis.dev/core";
// Mirrors packages/core/src/config.ts. The analyzer is browser-safe and must not import the
// server package, so the defaults are restated here and covered by a test.
const DEFAULT_MIGRATIONS_DIR = "./drizzle";
const DEFAULT_TENANT_COLUMNS = ["tenantId"];
const DEFAULT_OWNER_COLUMNS = ["ownerId"];
const DEFAULT_LOCALE = "en";
const DEFAULT_LOCALES = ["en"];

export interface ConfigResult {
  readonly facts: ConfigFacts;
  readonly diagnostics: readonly Diagnostic[];
}

function configDefaults(): ConfigFacts {
  return {
    parsed: false,
    source: null,
    permissions: [],
    roles: {},
    defaultRole: null,
    defaultLocale: DEFAULT_LOCALE,
    locales: [...DEFAULT_LOCALES],
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    tenantColumns: [...DEFAULT_TENANT_COLUMNS],
    ownerColumns: [...DEFAULT_OWNER_COLUMNS],
    unknown: [],
  };
}

export function emptyConfigFacts(): ConfigFacts {
  return configDefaults();
}

function stringField(
  section: Record<string, unknown>,
  key: string,
  fallback: string | null,
  unknown: UnknownFact[],
  at: SourceRef,
): string | null {
  if (!Object.hasOwn(section, key)) return fallback;
  if (typeof section[key] === "string") return section[key];
  unknown.push({ code: "config-static", reason: key + " must be a string", source: at });
  return fallback;
}

function stringArrayField(
  section: Record<string, unknown>,
  key: string,
  fallback: readonly string[],
  unknown: UnknownFact[],
  at: SourceRef,
): readonly string[] {
  if (!Object.hasOwn(section, key)) return fallback;
  const value = section[key];
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
    return [...value];
  }
  unknown.push({ code: "config-static", reason: key + " must be a string[]", source: at });
  return fallback;
}

function rolesField(
  section: Record<string, unknown>,
  unknown: UnknownFact[],
  at: SourceRef,
): Readonly<Record<string, readonly string[]>> {
  if (!Object.hasOwn(section, "roles")) return {};
  const value = section.roles;
  if (!isRecord(value)) {
    unknown.push({ code: "config-static", reason: "roles must be an object", source: at });
    return {};
  }
  const roles: Record<string, readonly string[]> = {};
  for (const [role, permissions] of Object.entries(value)) {
    if (Array.isArray(permissions) && permissions.every((item) => typeof item === "string")) {
      roles[role] = [...(permissions as string[])];
    } else {
      unknown.push({
        code: "config-static",
        reason: 'roles["' + role + '"] must be a string[]',
        source: at,
      });
    }
  }
  return roles;
}

function readSection(
  root: StaticObject,
  name: string,
  context: StaticContext,
  unknown: UnknownFact[],
): Record<string, unknown> | null {
  const field = root.fields.get(name);
  if (field === undefined) return null;
  if (field.ok && isRecord(field.value)) return field.value;
  const nested = readStaticObject(field.node, context, { code: "config-static", report: true });
  unknown.push(...nested.unknown);
  if (field.ok && nested.fields.size === 0) {
    unknown.push({
      code: "config-static",
      reason: name + " must be an object",
      source: refOf(context, field.node),
    });
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of nested.fields) if (value.ok) out[key] = value.value;
  return out;
}

/** The default export must be a `defineConfig(...)` call of the @facilis.dev/core named import. */
function resolveDefineConfig(file: ProjectFile): { call: AstNode | null; reason: string | null } {
  const expression = defaultExportExpression(file);
  if (expression === undefined) {
    return { call: null, reason: "facilis.config.ts has no default export" };
  }
  if (expression.type !== "CallExpression") {
    return { call: null, reason: "the default export is not a defineConfig() call" };
  }
  const callee = unwrapExpression(expression.callee);
  const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
  if (name === undefined) return { call: null, reason: "defineConfig must be called by name" };
  if (isLocallyDeclared(file, name)) {
    return { call: null, reason: 'defineConfig "' + name + '" is shadowed by a local declaration' };
  }
  const imported = file.module.imports.find((entry) => entry.local === name);
  if (imported === undefined) {
    return { call: null, reason: "defineConfig is not imported from @facilis.dev/core" };
  }
  if (imported.specifier !== CORE_SPECIFIER || imported.imported !== "defineConfig") {
    return { call: null, reason: "defineConfig must be the named import from @facilis.dev/core" };
  }
  return { call: expression, reason: null };
}

function validationIssues(
  facts: ConfigFacts,
  authMissing: boolean,
): {
  auth: string[];
  i18n: string[];
} {
  const auth: string[] = [];
  if (authMissing) auth.push("auth is required in facilis.config.ts");
  if (facts.permissions.includes("*")) auth.push('"*" is only valid inside auth.roles');
  const seenPermissions = new Set<string>();
  for (const permission of facts.permissions) {
    if (seenPermissions.has(permission)) auth.push('duplicate permission "' + permission + '"');
    seenPermissions.add(permission);
  }
  for (const [role, permissions] of Object.entries(facts.roles)) {
    const seen = new Set<string>();
    for (const permission of permissions) {
      if (permission !== "*" && !seenPermissions.has(permission)) {
        auth.push('role "' + role + '" references undeclared permission "' + permission + '"');
      }
      if (seen.has(permission)) auth.push('role "' + role + '" repeats "' + permission + '"');
      seen.add(permission);
    }
  }
  if (facts.defaultRole === null) {
    if (!authMissing) auth.push("auth.defaultRole is required");
  } else if (!Object.hasOwn(facts.roles, facts.defaultRole)) {
    auth.push('defaultRole "' + facts.defaultRole + '" is not a key of auth.roles');
  }
  const i18n: string[] = [];
  if (!facts.locales.includes(facts.defaultLocale ?? "")) {
    i18n.push('defaultLocale "' + (facts.defaultLocale ?? "") + '" must be listed in i18n.locales');
  }
  return { auth, i18n };
}

export function buildConfigFacts(graph: ModuleGraph): ConfigResult {
  const file = graph.file(projectPath(graph.root, CONFIG_FILE));
  if (file === undefined) {
    return {
      facts: emptyConfigFacts(),
      diagnostics: [
        error(
          "config-missing",
          CONFIG_FILE + " was not found; the project config is required",
          null,
        ),
      ],
    };
  }
  const context: StaticContext = { graph, file: file.path };
  const at = sourceRef(file.path, file.source, defaultExportDeclaration(file.program)?.start ?? 0);
  const resolved = resolveDefineConfig(file);
  if (resolved.call === null) {
    const reason = resolved.reason ?? "defineConfig() could not be resolved";
    return {
      facts: {
        ...configDefaults(),
        source: at,
        unknown: [{ code: "config-static", reason, source: at }],
      },
      diagnostics: [error("config-static", reason, at)],
    };
  }

  const root = readStaticObject(callArguments(resolved.call)[0], context, {
    code: "config-static",
    report: false,
  });
  const unknown: UnknownFact[] = [...root.unknown];
  const auth = readSection(root, "auth", context, unknown);
  const i18n = readSection(root, "i18n", context, unknown);
  const db = readSection(root, "db", context, unknown);
  const authRef = refOf(context, root.fields.get("auth")?.node);
  const i18nRef = refOf(context, root.fields.get("i18n")?.node);
  const base = configDefaults();
  const facts: ConfigFacts = {
    parsed: true,
    source: at,
    permissions: auth === null ? [] : stringArrayField(auth, "permissions", [], unknown, authRef),
    roles: auth === null ? {} : rolesField(auth, unknown, authRef),
    defaultRole: auth === null ? null : stringField(auth, "defaultRole", null, unknown, authRef),
    defaultLocale:
      i18n === null
        ? base.defaultLocale
        : stringField(i18n, "defaultLocale", base.defaultLocale, unknown, i18nRef),
    locales:
      i18n === null
        ? base.locales
        : stringArrayField(i18n, "locales", base.locales, unknown, i18nRef),
    migrationsDir:
      db === null
        ? base.migrationsDir
        : (stringField(db, "migrationsDir", base.migrationsDir, unknown, at) ?? base.migrationsDir),
    tenantColumns:
      db === null
        ? base.tenantColumns
        : stringArrayField(db, "tenantColumns", base.tenantColumns, unknown, at),
    ownerColumns:
      db === null
        ? base.ownerColumns
        : stringArrayField(db, "ownerColumns", base.ownerColumns, unknown, at),
    unknown,
  };
  const issues = validationIssues(facts, auth === null);
  const diagnostics = [
    ...unknown.map((fact) => error(fact.code, fact.reason, fact.source)),
    ...issues.auth.map((message) => error("config-invalid", message, authRef)),
    ...issues.i18n.map((message) => error("config-invalid", message, i18nRef)),
  ];
  return { facts, diagnostics: sortDiagnostics(diagnostics) };
}
