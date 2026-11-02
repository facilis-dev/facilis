/**
 * @facilis/ai — the SPEC §9.3 patch validator and the contracts it shares with the IDE
 * chat (patches, findings, project context).
 *
 * This entry must stay browser-safe: no TypeScript/oxc parser, no Node builtin, no
 * filesystem. Rule 1's parser is injected as a {@link SyntaxChecker} (the IDE passes
 * Monaco's TypeScript worker; Node tooling imports the `@facilis/ai/node` subpath, the
 * only module that imports rolldown). The project context is assembled by the caller from
 * the VFS and the live manifest and handed to `validatePatch`.
 */

export { buildProjectContext } from "./context.ts";
export { checkPatchSyntax } from "./syntax-runner.ts";
export type {
  BlockFacts,
  ConfigFacts,
  FilePatch,
  ImportAlias,
  PatchContext,
  ProjectContext,
  ProjectContextInput,
  RouteFacts,
  SchemaFacts,
  SyntaxCheck,
  SyntaxChecker,
  SyntaxFinding,
  SyntaxIssue,
  TableFacts,
  ValidatePatchOptions,
  ValidationError,
  ValidationResult,
} from "./types.ts";
export { validatePatch } from "./validator.ts";
