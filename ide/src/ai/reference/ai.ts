import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/ai` — the SPEC §9.3 patch validator and its contracts (D-092).
 *
 * The main entry is browser-safe: the TypeScript parser is injected (the IDE passes the
 * analyzer worker's parser, Node tooling imports @facilis.dev/ai/node). Facts come from an
 * @facilis.dev/analyze Analysis, never from a re-parse of the patch text.
 */
export const AI_MODULE: FrameworkModule = {
  id: "ai",
  package: "@facilis.dev/ai",
  summary:
    "The 19-rule patch validator, its patch/finding contracts, the injected syntax checker and the project-context builder.",
  entries: [
    {
      name: "validatePatch",
      kind: "function",
      signature:
        "validatePatch(patches: readonly FilePatch[], options?: ValidatePatchOptions): ValidationResult",
      summary:
        "Runs the SPEC §9.3 rules over a patch set: without a context only the context-free structural rules run; with one, every route/schema/i18n/job rule runs. Errors block the write; warnings never do.",
      example:
        'const result = validatePatch([{ path: "server/routes/api/todos/index.get.ts", action: "create", content }], { context });',
    },
    {
      name: "FilePatch",
      kind: "type",
      signature:
        'interface FilePatch { path: string; action: "create" | "update" | "delete"; content?: string }',
      summary:
        "One proposed file write; delete has no content, create/update carry the full new file text.",
    },
    {
      name: "ValidationError",
      kind: "type",
      signature:
        'interface ValidationError { rule: string; severity: "error" | "warning"; file: string; message: string; fix_hint: string; infrastructure?: boolean; line?: number; column?: number; excerpt?: string }',
      summary:
        "One validator finding: stable rule id plus the fix hint; infrastructure findings are the validator's own failure and must not be sent back to the model as repair work.",
    },
    {
      name: "ValidationResult",
      kind: "type",
      signature:
        "interface ValidationResult { ok: boolean; errors: ValidationError[]; warnings: ValidationError[]; destructive?: boolean }",
      summary:
        "The validator result: ok is false exactly when errors is non-empty; destructive flags a table/column drop and may be true on an ok result.",
    },
    {
      name: "ValidatePatchOptions",
      kind: "type",
      signature:
        'interface ValidatePatchOptions { context?: PatchContext; requiresConfirmation?: boolean; allowedRootFiles?: readonly string[]; writePolicy?: "open" | "managed" }',
      summary:
        "Validator options: the effective post-patch context, the response's requires_confirmation flag for the destructive rule, root-file exceptions (IDE writers only) and the writable-set policy.",
    },
    {
      name: "checkPatchSyntax",
      kind: "function",
      signature:
        "checkPatchSyntax(patches: readonly FilePatch[], checker: SyntaxChecker): Promise<SyntaxFinding[]>",
      summary:
        "The only async validation step (rule 1): runs the injected parser over the patch's script files and returns per-file syntax findings; the caller stores the result as the context's syntax check.",
    },
    {
      name: "SyntaxChecker",
      kind: "type",
      signature:
        "interface SyntaxChecker { check(path: string, content: string): Promise<readonly SyntaxIssue[]> }",
      summary:
        "The rule-1 seam: the IDE injects the analyzer worker's parser, Node tooling the @facilis.dev/ai/node adapter, so the main package stays parser-free.",
    },
    {
      name: "buildProjectContext",
      kind: "function",
      signature: "buildProjectContext(input: ProjectContextInput): ProjectContext",
      summary:
        "Assembles the typed context from analyzer facts: files, effective and pre-patch Analysis, config, flattened default-locale catalogue, installed packages and tsconfig aliases.",
    },
    {
      name: "WritePolicy",
      kind: "type",
      signature: 'type WritePolicy = "open" | "managed"',
      summary:
        'Rule 11 writable set (D-167): "managed" (default) keeps the six source roots, "open" accepts the whole project minus install/VCS/instruction surfaces.',
    },
  ],
};
