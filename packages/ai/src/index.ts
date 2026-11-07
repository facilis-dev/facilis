/**
 * @facilis/ai — the SPEC §9.3 patch validator and the contracts it shares with the IDE
 * chat (patches, findings, project context).
 *
 * This entry must stay browser-safe: no TypeScript/oxc parser, no Node builtin, no
 * filesystem. Rule 1's parser is injected as a {@link SyntaxChecker} (the IDE passes
 * Monaco's TypeScript worker; Node tooling imports the `@facilis/ai/node` subpath, the
 * only module that imports a parser). Project facts come from @facilis/analyze's Analysis,
 * which the caller builds from the VFS file map; every analyzer import here is type-only,
 * so no analyzer runtime value is bundled into the IDE.
 */

export { buildProjectContext } from "./context.ts";
export { checkPatchSyntax } from "./syntax-runner.ts";
export type {
  Analysis,
  BlockFacts,
  ColumnFact,
  ConfigFacts,
  Diagnostic,
  FileFacts,
  FilePatch,
  ImportAlias,
  ImportFact,
  LocaleCatalogs,
  PatchContext,
  ProjectContext,
  ProjectContextInput,
  RouteFact,
  SchemaSummary,
  SourceRef,
  SyntaxCheck,
  SyntaxChecker,
  SyntaxFinding,
  SyntaxIssue,
  TableFact,
  TranslationCallFact,
  ValidatePatchOptions,
  ValidationError,
  ValidationResult,
} from "./types.ts";
export { validatePatch } from "./validator.ts";
