/**
 * Shared contracts of the SPEC §9.3 patch validator.
 *
 * Project facts now come from @facilis.dev/analyze's AST interpreter (D-092), not from local
 * text scanners. This module only imports analyzer *types* (erased at build), so the main
 * entry keeps its browser-safety guarantee: no analyzer runtime value is loaded.
 *
 * The caller supplies the effective post-patch {@link Analysis} plus, optionally, the
 * pre-patch one. `null` means unknown and `[]` means explicitly empty, exactly as in the
 * analyzer's fact model.
 */

import type {
  Analysis,
  ConfigFacts as AnalyzerConfigFacts,
  RouteFact as AnalyzerRouteFact,
  TableFact as AnalyzerTableFact,
} from "@facilis.dev/analyze";

export type { Analysis, AnalyzerConfigFacts, AnalyzerRouteFact, AnalyzerTableFact };
export type {
  ColumnFact,
  Diagnostic,
  FileFacts,
  ImportFact,
  JobFact,
  JobRelationsFact,
  LocaleCatalogs,
  RouteElevationUsage,
  RouteRelationUse,
  RouteRelationsFact,
  SourceRef,
  TranslationCallFact,
  ViewFact,
} from "@facilis.dev/analyze";

/** Readable aliases for the analyzer facts the rules consume. */
export type ConfigFacts = AnalyzerConfigFacts;
export type RouteFact = AnalyzerRouteFact;
export type TableFact = AnalyzerTableFact;

/**
 * Rule 11's writable set, selected by the deployment profile (D-167). `managed` keeps the
 * six source roots (D-084); `open` accepts the whole project minus the install, VCS/IDE and
 * instruction surfaces. The default is `managed`, so an external caller changes nothing.
 */
export type WritePolicy = "open" | "managed";

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
  /**
   * The finding is about the validator's own plumbing (parser/analyzer unavailable), not the
   * patch. The IDE must not ask the model to repair it; it retries or reports it to the user.
   */
  infrastructure?: boolean;
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
 * The rule-1 seam. The IDE injects the analyzer worker's oxc parser; Node tooling injects
 * `@facilis.dev/ai/node` (the subpath is the only place that imports a parser).
 */
export interface SyntaxChecker {
  check(path: string, content: string): Promise<readonly SyntaxIssue[]>;
}

/** Rule 1's input: "unavailable" makes the rule fail closed for script patches. */
export type SyntaxCheck =
  | { status: "checked"; findings: readonly SyntaxFinding[] }
  | { status: "unavailable"; reason: string };

/** One registered block component (live manifest only; not a source fact; reserved, D-131). */
export interface BlockFacts {
  name: string;
}

/** A tsconfig `paths` alias such as `"~/": ""` (project-relative target). */
export interface ImportAlias {
  prefix: string;
  target: string;
}

/** Raw material a caller assembles before the validator runs. */
export interface ProjectContextInput {
  /** Project-relative paths that exist before the patch (the pre-patch file set). */
  files: readonly string[];
  /** The effective (post-patch) analysis: the facts the rules must validate. */
  analysis: Analysis;
  /** The pre-patch analysis, for inverse edits. Defaults to `analysis`. */
  before?: Analysis;
  /** The `/__facilis/manifest` envelope's manifest: blocks and catalog fallback only. */
  manifest?: unknown;
  /** Installed bare specifiers; derived from package.json when omitted. */
  packages?: readonly string[];
  aliases?: readonly ImportAlias[];
  /** Only `package.json` and `tsconfig.json` are read from here; everything else is facts. */
  sources?: Readonly<Record<string, string>>;
}

export interface SchemaSummary {
  readonly parsed: boolean;
  readonly tables: readonly TableFact[];
}

/** The typed project context every context-dependent rule reads. */
export interface ProjectContext {
  files: readonly string[];
  /** Effective (post-patch) facts. */
  analysis: Analysis;
  /** Pre-patch facts; equal to `analysis` when the caller has none. */
  before: Analysis;
  config: ConfigFacts;
  schema: SchemaSummary;
  /** Flattened default-locale catalogue (analyzer first, manifest fallback). */
  locales: Readonly<Record<string, string>>;
  blocks: readonly BlockFacts[];
  routes: readonly RouteFact[];
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
  /** Rule 11's writable set (D-167). Defaults to `managed`, the strict roots. */
  writePolicy?: WritePolicy;
}
