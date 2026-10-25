import { schemaSnapshot } from "@facilis/db";
import type { FacilisConfig, ManifestWarning } from "@facilis/core";
import config, { coreVersion, nitroVersion } from "#facilis/config";
import routeMetadata from "#facilis/openapi-meta";

import { getBootstrap } from "./bootstrap.ts";
import { isFacilisConfig } from "./config.ts";
import {
  buildManifestData,
  type ManifestDataResult,
  type ManifestDataSources,
} from "./manifest-data.ts";
import { getRevisionSnapshot } from "./revision-service.ts";

export interface ManifestSnapshot {
  readonly data: ManifestDataResult;
  readonly revision: string;
  readonly generatedAt: string;
  readonly warnings: readonly ManifestWarning[];
}

/**
 * Assemble everything `/__facilis/manifest` needs.
 *
 * Returns null only when the project config itself is unusable (the module cannot
 * describe the project at all); a broken schema is a 200-partial via
 * ManifestDataResult.partial (SPEC §6.4/§6.7).
 */
export async function getManifestSnapshot(): Promise<ManifestSnapshot | null> {
  const [revision, bootstrap] = await Promise.all([getRevisionSnapshot(), getBootstrap()]);
  const projectConfig = resolveConfig(bootstrap.config);
  if (projectConfig === null) return null;

  const schemaOutcome = await readSchema(bootstrap.db);
  const sources: ManifestDataSources = {
    config: projectConfig,
    routeMetadata,
    catalogs: revision.catalogs,
    coreVersion,
    nitroVersion,
    ...schemaOutcome,
  };

  const data = buildManifestData(sources);
  return {
    data,
    revision: revision.revision,
    generatedAt: revision.generatedAt,
    warnings: [...bootstrap.warnings, ...data.warnings],
  };
}

function resolveConfig(bootstrapped: FacilisConfig | null): FacilisConfig | null {
  if (bootstrapped !== null) return bootstrapped;
  // The middleware may not have run yet (e.g. a direct handler import in tests);
  // the virtual module is still a valid config source when the bootstrap failed early.
  return isFacilisConfig(config) ? config : null;
}

async function readSchema(
  db: Awaited<ReturnType<typeof getBootstrap>>["db"],
): Promise<{ schema?: Awaited<ReturnType<typeof schemaSnapshot>>; failure?: ManifestWarning }> {
  if (db === null) {
    return {
      failure: {
        code: "db_unavailable",
        message: "The database could not be booted; the schema section is unavailable.",
        section: "schema",
      },
    };
  }
  try {
    return { schema: await schemaSnapshot(db) };
  } catch (error) {
    return {
      failure: {
        code: "schema_unavailable",
        message: `Schema introspection failed: ${error instanceof Error ? error.message : String(error)}`,
        section: "schema",
      },
    };
  }
}
