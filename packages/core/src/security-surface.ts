import { z } from "zod";

/**
 * The versioned security-surface document (D-226, SPEC §8.9).
 *
 * This is the release artifact a security review reads: every non-standard capability with
 * its reason, file and line, plus an explicit `unknown` bucket. It is deterministic for a
 * commit (no timestamps): the same source produces the same bytes, so a release can be
 * compared against the previous one.
 *
 * Schema changes are versioned: additive fields keep version 1; a breaking change bumps it.
 */
export const SECURITY_SURFACE_FORMAT_VERSION = 1;

export const SURFACE_CLASS_VALUES = ["standard", "declared", "undeclared", "unknown"] as const;
export const SURFACE_KIND_VALUES = [
  "raw-route",
  "server-extension",
  "raw-db",
  "raw-sql",
  "dynamic-code",
] as const;
export const SERVER_EXTENSION_KIND_VALUES = ["plugin", "middleware", "module", "task"] as const;

const sourceSchema = z.strictObject({
  file: z.string().min(1),
  line: z.number().int().positive(),
});

const unknownFactSchema = z.strictObject({
  code: z.string().min(1),
  reason: z.string().min(1),
  source: sourceSchema,
});

const confirmedSchema = z.strictObject({
  at: z.string().min(1),
  by: z.string().min(1),
});

const declarationSchema = z.strictObject({
  kind: z.enum(SURFACE_KIND_VALUES),
  reason: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive(),
  confirmed: confirmedSchema.optional(),
});

const routeSchema = z.strictObject({
  path: z.string().min(1),
  method: z.string().min(1),
  class: z.enum(SURFACE_CLASS_VALUES),
  auth: z.enum(["required", "none"]).nullable(),
  permission: z.array(z.string()).nullable(),
  dbTables: z.array(z.string()).nullable(),
  declarations: z.array(declarationSchema),
  source: sourceSchema,
  warnings: z.array(z.string()),
  unknown: z.array(unknownFactSchema),
});

const extensionSchema = z.strictObject({
  file: z.string().min(1),
  kind: z.enum(SERVER_EXTENSION_KIND_VALUES),
  class: z.enum(SURFACE_CLASS_VALUES),
  declarations: z.array(declarationSchema),
  source: sourceSchema,
  unknown: z.array(unknownFactSchema),
});

const importSchema = z.strictObject({
  file: z.string().min(1),
  specifier: z.string().min(1),
  symbol: z.string().min(1),
  source: sourceSchema,
});

const dynamicCodeSchema = z.strictObject({
  file: z.string().min(1),
  form: z.enum(["eval", "new-function", "computed-import"]),
  class: z.enum(SURFACE_CLASS_VALUES),
  declarations: z.array(declarationSchema),
  source: sourceSchema,
});

const summarySchema = z.strictObject({
  standard: z.number().int().nonnegative(),
  declared: z.number().int().nonnegative(),
  undeclared: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export const securitySurfaceSchema = z.strictObject({
  version: z.literal(SECURITY_SURFACE_FORMAT_VERSION),
  project: z.string().min(1),
  revision: z.string().min(1),
  summary: summarySchema,
  routes: z.array(routeSchema),
  extensions: z.array(extensionSchema),
  imports: z.array(importSchema),
  dynamicCode: z.array(dynamicCodeSchema),
  unknown: z.array(unknownFactSchema),
});

export type SecuritySurfaceDocument = z.infer<typeof securitySurfaceSchema>;
export type SecuritySurfaceRoute = z.infer<typeof routeSchema>;
export type SecuritySurfaceExtension = z.infer<typeof extensionSchema>;
export type SecuritySurfaceImport = z.infer<typeof importSchema>;
export type SecuritySurfaceDynamicCode = z.infer<typeof dynamicCodeSchema>;
export type SecuritySurfaceSummary = z.infer<typeof summarySchema>;

export type SecuritySurfaceParseResult =
  | { readonly ok: true; readonly document: SecuritySurfaceDocument }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Validate a document as it travels between the build, the IDE and the review. */
export function parseSecuritySurface(input: unknown): SecuritySurfaceParseResult {
  const result = securitySurfaceSchema.safeParse(input);
  if (result.success) return { ok: true, document: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message),
  };
}

/** Stable serialization: the release artifact is compared byte-for-byte. */
export function serializeSecuritySurface(document: SecuritySurfaceDocument): string {
  const parsed = parseSecuritySurface(document);
  if (!parsed.ok) throw new Error("security_surface_invalid: " + parsed.issues.join("; "));
  return JSON.stringify(parsed.document, null, 2) + "\n";
}
