import { computeRevision } from "@facilis/core";
import type { LocaleCatalogs } from "@facilis/core";
import routeMetadata from "#facilis/openapi-meta";
import { configPath, projectRoot } from "#facilis/config";

import { collectLocaleCatalogs, collectSchemaFiles, readTextFile } from "./project-files.ts";

export interface RevisionSnapshot {
  readonly revision: string;
  readonly generatedAt: string;
  readonly catalogs: LocaleCatalogs;
  readonly configContent: string;
}

/**
 * Compute the manifest revision on demand (SPEC §6.5: no watchers required).
 *
 * Inputs: raw facilis.config.ts source, db/schema.ts + its relative imports, the
 * AST-pass route metadata (the facilis-owned part of the OpenAPI document) and the
 * locale catalogues. Block manifests are a Phase 5 concern; they default to [].
 */
export async function getRevisionSnapshot(): Promise<RevisionSnapshot> {
  const [configSource, schemaFiles, catalogs] = await Promise.all([
    readTextFile(configPath),
    collectSchemaFiles(projectRoot),
    collectLocaleCatalogs(projectRoot),
  ]);

  const configContent = configSource ?? "";
  const revision = await computeRevision({
    configContent,
    schemaFiles,
    openApiSpec: routeMetadata,
    localeCatalogs: catalogs,
  });

  return { revision, generatedAt: new Date().toISOString(), catalogs, configContent };
}
