/**
 * Shared contracts of the SPEC §9.3 patch validator.
 *
 * The main entry must stay browser-safe, so nothing here imports TypeScript or a Node
 * builtin: rule 1 parses through an injected {@link SyntaxChecker} and everything the
 * context-dependent rules need is pre-parsed into the fact types below.
 */

/** One proposed file write (SPEC §9.2 response contract). */
export interface FilePatch {
  path: string;
  action: "create" | "update" | "delete";
  content?: string;
}

/** One validator finding (SPEC §7.6): machine-readable rule id plus file and detail. */
export interface ValidationError {
  rule: string;
  severity: "error" | "warning";
  file: string;
  /** The detail a caller can show or feed back to the model; never prose-free UI copy. */
  message: string;
  /** What to change to clear the finding. */
  fix_hint: string;
  line?: number;
  column?: number;
  /** The offending source line, capped, when it is cheap to provide. */
  excerpt?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/** One parse diagnostic from the injected TypeScript service (rule 1). */
export interface SyntaxIssue {
  line: number;
  column: number;
  message: string;
}

export interface SyntaxFinding extends SyntaxIssue {
  file: string;
}

/**
 * The rule-1 seam. The IDE injects Monaco's TypeScript worker; Node tooling injects
 * `@facilis/ai/node` (the subpath is the only place that imports a parser, rolldown).
 */
export interface SyntaxChecker {
  check(path: string, content: string): Promise<readonly SyntaxIssue[]>;
}

/** Rule 1's input: "unavailable" makes the rule fail closed for script patches. */
export type SyntaxCheck =
  | { status: "checked"; findings: readonly SyntaxFinding[] }
  | { status: "unavailable"; reason: string };

/** Roles and permissions declared by `facilis.config.ts` (SPEC §8.4.1). */
export interface ConfigFacts {
  /** The source parsed as a defineConfig object (false means manifest fallback only). */
  parsed: boolean;
  hasAuth: boolean;
  permissions: readonly string[];
  roles: Readonly<Record<string, readonly string[]>>;
  defaultRole: string | null;
  defaultLocale: string | null;
  locales: readonly string[];
  blocksPackages: readonly string[];
  migrationsDir: string;
  tenantColumns: readonly string[];
  ownerColumns: readonly string[];
}

/** One table of the code schema (db/schema.ts) or of the live manifest. */
export interface TableFacts {
  /** SQL table name (drizzle's first `pgTable` argument). */
  name: string;
  /** The `export const` binding name, when it differs from the SQL name. */
  variable?: string;
  columns: readonly string[];
  rlsEnabled: boolean;
  policies: readonly string[];
  /** A scoped column (tenant/owner) is present, so the table needs an RLS policy. */
  scoped: boolean;
  source: "schema" | "manifest" | "re-export";
}

export interface SchemaFacts {
  parsed: boolean;
  tables: readonly TableFacts[];
}

export interface BlockFacts {
  name: string;
}

/** One route the framework currently serves (SPEC §7.3 RouteMeta). */
export interface RouteFacts {
  method: string | null;
  path: string | null;
  permissions: readonly string[];
  dbTables: readonly string[];
  dbColumns: readonly string[];
  sourceFile: string | null;
}

/** A tsconfig `paths` alias such as `"~/": ""` (project-relative target). */
export interface ImportAlias {
  prefix: string;
  target: string;
}

/** Raw material a caller assembles before the validator runs. */
export interface ProjectContextInput {
  /** Project-relative paths that exist before the patch. */
  files: readonly string[];
  /** Raw project sources the rules inspect (config, schema, locales, package.json, tsconfig). */
  sources?: Readonly<Record<string, string>>;
  /** The `/__facilis/manifest` envelope's manifest, when the project is running. */
  manifest?: unknown;
  /** Installed bare specifiers; derived from package.json when omitted. */
  packages?: readonly string[];
  aliases?: readonly ImportAlias[];
}

/** The typed project context every context-dependent rule reads. */
export interface ProjectContext {
  files: readonly string[];
  sources: Readonly<Record<string, string>>;
  config: ConfigFacts;
  schema: SchemaFacts;
  locales: Readonly<Record<string, string>>;
  blocks: readonly BlockFacts[];
  routes: readonly RouteFacts[];
  packages: readonly string[];
  aliases: readonly ImportAlias[];
}

/** The complete validator input: the project context plus the rule-1 result. */
export interface PatchContext extends ProjectContext {
  syntax: SyntaxCheck;
}

export interface ValidatePatchOptions {
  /** Without a context only the context-free structural rules run (parser gate). */
  context?: PatchContext;
  /** The AIResponse `requires_confirmation` flag, for rule 15. */
  requiresConfirmation?: boolean;
  /**
   * Extra root files this write may touch. Only the IDE's own writers pass it (e.g. the
   * AGENTS.md scaffold); AI patches never do, so the model cannot persist instructions.
   */
  allowedRootFiles?: readonly string[];
}
