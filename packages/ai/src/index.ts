/**
 * @facilis.dev/ai — the SPEC §9.3 patch validator and the contracts it shares with the IDE
 * chat (patches, findings, project context).
 *
 * This entry must stay browser-safe: no TypeScript/oxc parser, no Node builtin, no
 * filesystem. Rule 1's parser is injected as a {@link SyntaxChecker} (the IDE passes the
 * analyzer worker's oxc parser; Node tooling imports the `@facilis.dev/ai/node` subpath, the
 * only module that imports a parser). Project facts come from @facilis.dev/analyze's Analysis,
 * which the caller builds from the VFS file map; analyzer imports here are type-only except
 * the route-description rule's shared character limit (D-129), a plain constant with no
 * parser or Node dependency, so nothing heavy is bundled into the IDE.
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
