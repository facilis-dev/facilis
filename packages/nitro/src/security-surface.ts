/**
 * The declared-surface build projection (D-226, #235).
 *
 * The analyzer decides classes; this module only serializes those facts into the versioned
 * document and derives the build-gate issues from the same objects. There is deliberately
 * no second classification here: the IDE graph, the artifact and the gate cannot disagree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Nitro } from "nitro/types";
import type { Analysis, RouteFact } from "@facilis.dev/analyze";
import type {
  SecuritySurfaceDocument,
  SecuritySurfaceDynamicCode,
  SecuritySurfaceExtension,
  SecuritySurfaceImport,
  SecuritySurfaceRoute,
} from "@facilis.dev/core";
import { SECURITY_SURFACE_FORMAT_VERSION, serializeSecuritySurface } from "@facilis.dev/core";

import { analyzeProjectRoutes } from "./route-metadata.ts";
import { enforceDeclaredSurface } from "./surface-mount.ts";

export interface SurfaceGateIssue {
  readonly code: string;
  readonly message: string;
  readonly file: string | null;
  readonly line: number | null;
}

function bySource(left: { file: string }, right: { file: string }): number {
  return left.file.localeCompare(right.file);
}

function routeDiagnostics(analysis: Analysis, route: RouteFact): string[] {
  return analysis.diagnostics
    .filter((entry) => entry.source?.file === route.sourceFile)
    .map((entry) => entry.code + ": " + entry.message)
    .toSorted();
}

function mapRoute(analysis: Analysis, route: RouteFact): SecuritySurfaceRoute {
  return {
    path: route.path,
    method: route.method,
    class: route.surface.class,
    auth: route.auth,
    permission: route.permission === null ? null : [...route.permission],
    dbTables: route.dbTables === null ? null : [...route.dbTables],
    declarations: route.surface.declarations
      .map((entry) => ({
        kind: entry.kind,
        reason: entry.reason,
        file: entry.source.file,
        line: entry.source.line,
        ...(entry.confirmed === undefined ? {} : { confirmed: entry.confirmed }),
      }))
      .toSorted((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
    source: { file: route.source.file, line: route.source.line },
    warnings: routeDiagnostics(analysis, route),
    unknown: route.unknown.map((entry) => ({
      code: entry.code,
      reason: entry.reason,
      source: { file: entry.source.file, line: entry.source.line },
    })),
  };
}

function mapExtension(analysis: Analysis): SecuritySurfaceExtension[] {
  return analysis.surface.extensions
    .map((extension) => ({
      file: extension.file,
      kind: extension.kind,
      class: extension.surface.class,
      declarations: extension.surface.declarations.map((entry) => ({
        kind: entry.kind,
        reason: entry.reason,
        file: entry.source.file,
        line: entry.source.line,
        ...(entry.confirmed === undefined ? {} : { confirmed: entry.confirmed }),
      })),
      source: {
        file: extension.surface.source.file,
        line: extension.surface.source.line,
      },
      unknown: extension.surface.unknown.map((entry) => ({
        code: entry.code,
        reason: entry.reason,
        source: { file: entry.source.file, line: entry.source.line },
      })),
    }))
    .toSorted(bySource);
}

function mapImports(analysis: Analysis): SecuritySurfaceImport[] {
  return analysis.surface.forbiddenImports
    .map((entry) => ({
      file: entry.file,
      specifier: entry.specifier,
      symbol: entry.imported,
      source: { file: entry.source.file, line: entry.source.line },
    }))
    .toSorted(bySource);
}

function mapDynamicCode(analysis: Analysis): SecuritySurfaceDynamicCode[] {
  return analysis.surface.dynamicCode
    .map((entry) => ({
      file: entry.file,
      form: entry.form,
      class: entry.surface.class,
      declarations: entry.surface.declarations.map((declaration) => ({
        kind: declaration.kind,
        reason: declaration.reason,
        file: declaration.source.file,
        line: declaration.source.line,
      })),
      source: { file: entry.surface.source.file, line: entry.surface.source.line },
    }))
    .toSorted(bySource);
}

/** Build the versioned document from one analysis; determinism comes from sorted arrays. */
export function buildSecuritySurfaceDocument(
  analysis: Analysis,
  project: string,
): SecuritySurfaceDocument {
  const summary = { standard: 0, declared: 0, undeclared: 0, unknown: 0 };
  for (const route of analysis.routes) summary[route.surface.class] += 1;
  for (const extension of analysis.surface.extensions) summary[extension.surface.class] += 1;
  for (const entry of analysis.surface.dynamicCode) summary[entry.surface.class] += 1;
  summary.undeclared += analysis.surface.forbiddenImports.length;

  return {
    version: SECURITY_SURFACE_FORMAT_VERSION,
    project,
    revision: analysis.revision,
    summary,
    routes: analysis.routes
      .map((route) => mapRoute(analysis, route))
      .toSorted(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.method.localeCompare(right.method) ||
          left.source.file.localeCompare(right.source.file),
      ),
    extensions: mapExtension(analysis),
    imports: mapImports(analysis),
    dynamicCode: mapDynamicCode(analysis),
    unknown: analysis.surface.unknown.map((entry) => ({
      code: entry.code,
      reason: entry.reason,
      source: { file: entry.source.file, line: entry.source.line },
    })),
  };
}

/**
 * The epic's fail-closed set: a route or extension that is not standard/declared, a
 * forbidden db import, and undeclared dynamic code. Unknown is an issue too — it is never
 * green — while unrelated analyzer warnings stay warnings.
 */
export function securitySurfaceIssues(analysis: Analysis): SurfaceGateIssue[] {
  const issues: SurfaceGateIssue[] = [];
  for (const route of analysis.routes) {
    if (route.surface.class === "undeclared" || route.surface.class === "unknown") {
      issues.push({
        code: "surface-" + route.surface.class,
        message:
          "Route " +
          route.method +
          " " +
          route.path +
          " is " +
          route.surface.class +
          " (D-226); declare it with defineRawRoute/rawSql/ctx.rawDb or use defineAuthorizedHandler.",
        file: route.sourceFile,
        line: route.source.line,
      });
    }
  }
  for (const extension of analysis.surface.extensions) {
    if (extension.surface.class === "undeclared" || extension.surface.class === "unknown") {
      issues.push({
        code: "surface-" + extension.surface.class,
        message:
          "Server extension " +
          extension.file +
          " is " +
          extension.surface.class +
          "; wrap it in defineServerExtension({ reason }) (D-226).",
        file: extension.file,
        line: extension.surface.source.line,
      });
    }
  }
  for (const entry of analysis.surface.forbiddenImports) {
    issues.push({
      code: "surface-forbidden-import",
      message:
        'Forbidden @facilis.dev/db import "' +
        entry.imported +
        '" in ' +
        entry.file +
        "; only the declarative db API is allowed (D-226).",
      file: entry.file,
      line: entry.source.line,
    });
  }
  for (const entry of analysis.surface.dynamicCode) {
    if (entry.surface.class !== "declared") {
      issues.push({
        code: "surface-" + entry.surface.class,
        message:
          "Dynamic code (" +
          entry.form +
          ") in " +
          entry.file +
          " needs a // dynamic-code: <reason> marker (D-226).",
        file: entry.file,
        line: entry.surface.source.line,
      });
    }
  }
  return issues.toSorted(
    (left, right) =>
      (left.file ?? "").localeCompare(right.file ?? "") ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.code.localeCompare(right.code),
  );
}

/**
 * The one entry the Nitro module calls (D-226): filter the mount lists now, and write the
 * release document when the build compiles. The artifact lives in Nitro's output directory
 * next to the server, so a tagged release can store it without a second computation.
 */
export function registerSecuritySurface(nitro: Nitro, rootDir: string): void {
  const analysis = analyzeProjectRoutes(rootDir);
  if (analysis !== undefined) enforceDeclaredSurface(nitro, rootDir, analysis);
  // A unit-test mock of Nitro has no hook bus or output directory; the production instance
  // always has both, and a missing seam must not change the mount gate's behavior.
  nitro.hooks?.hook("compiled", (instance) => {
    const current = analyzeProjectRoutes(rootDir);
    if (current === undefined) return;
    const document = buildSecuritySurfaceDocument(current, basename(rootDir));
    const output = instance.options.output?.dir;
    if (output === undefined) return;
    mkdirSync(output, { recursive: true });
    writeFileSync(
      join(output, "security-surface.json"),
      serializeSecuritySurface(document),
      "utf8",
    );
  });
}

