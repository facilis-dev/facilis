import { createDb, type FacilisDb } from "@facilis/db";
import { sessionMiddleware, type SessionEvent } from "@facilis/auth";
import {
  type FacilisConfig,
  type FacilisLoggingApi,
  type FacilisLoggingConfig,
  type ManifestWarning,
  type StorageApi,
} from "@facilis/core";
import { projectRoot } from "#facilis/config";
import dbSchema from "#facilis/db-schema";
import dbViewModules from "#facilis/db-views";
import jobModules from "#facilis/jobs";
import workflowModules from "#facilis/workflows";

import { toAuthConfig } from "./config.ts";
import { bootstrapDevelopmentDatabase, describe } from "./db-bootstrap.ts";
import { resolveDbTarget } from "./db-target.ts";
import {
  devDbSnapshotPath,
  installDevDbSnapshotter,
  readDevDbSnapshot,
} from "./dev-db-persistence.ts";
import { bootRuntimes } from "./boot-runtimes.ts";
import { isProductionEnvironment } from "./env.ts";
import type { JobsRuntime } from "./jobs/runtime.ts";
import type { TasksRuntime } from "./tasks/boot.ts";
import type { WorkflowsRuntime } from "./workflows/runner.ts";
import { readProjectConfig } from "./project-config.ts";
import { createBootstrapLogging } from "./logging/bootstrap-logging.ts";
import { installSudoAuditBridge } from "./logging/sudo-bridge.ts";
import { readDefaultTenantId } from "./tenant.ts";
import { resolveStorage } from "./storage-target.ts";

export interface BootstrapState {
  readonly db: FacilisDb | null;
  readonly config: FacilisConfig | null;
  readonly warnings: readonly ManifestWarning[];
  readonly startedAt: string;
  /**
   * Background-job runtime (D-107); null when the db or the job boot failed. The context
   * middleware carries `jobs.api` on `event.context.facilis`.
   */
  readonly jobs: JobsRuntime | null;
  /**
   * Manual-task runtime (D-135); null when facilis_tasks is missing or the task boot failed.
   * The context middleware carries tasks.api on event.context.facilis.
   */
  readonly tasks: TasksRuntime | null;
  /**
   * Workflow runtime (D-135); null when the tables or the job queue are unavailable. The
   * context middleware carries workflows.api on event.context.facilis.
   */
  readonly workflows: WorkflowsRuntime | null;
  /** Binary-storage runtime (D-053); null when the boot refused its configuration. */
  readonly storage: StorageApi | null;
  /**
   * Operator logging runtime (D-119). Always present: built from the documented defaults when
   * the project config failed, so the request context never lacks a logger.
   */
  readonly logging: FacilisLoggingApi;
  /** Effective logging config (project defaults + env level override) for the middleware. */
  readonly loggingConfig: FacilisLoggingConfig;
  /** Cached session handler; rebuilt lazily because it closes over the db client. */
  sessionHandler?: (event: SessionEvent) => Promise<void>;
}

let bootstrapPromise: Promise<BootstrapState> | undefined;

/**
 * Boot the framework runtime once per process (lazily, on the first request).
 *
 * Contract (docs/archive/PHASE1-CONTRACTS.md §8): never crash the request. Each failure is
 * recorded as a manifest warning and the remaining steps still run, so a broken
 * migration yields a 200 partial manifest instead of a 500.
 */
export function getBootstrap(): Promise<BootstrapState> {
  bootstrapPromise ??= bootstrap();
  return bootstrapPromise;
}

export function getSessionHandler(
  state: BootstrapState,
): ((event: SessionEvent) => Promise<void>) | null {
  if (state.db === null || state.config === null) return null;
  state.sessionHandler ??= sessionMiddleware({
    db: state.db,
    config: toAuthConfig(state.config.auth),
    tenantId: readDefaultTenantId(),
  });
  return state.sessionHandler;
}

async function bootstrap(): Promise<BootstrapState> {
  const warnings: ManifestWarning[] = [];
  const startedAt = new Date().toISOString();
  const projectConfig = readProjectConfig(warnings);

  // Operator logging is built BEFORE the database (D-119): a database boot failure must not
  // take the access/error streams down with it, and logging never prevents a boot.
  const loggingState = createBootstrapLogging({
    loggingConfig: projectConfig?.logging ?? null,
    env: process.env,
    projectRoot,
  });
  warnings.push(...loggingState.warnings);
  const loggingFields = {
    logging: loggingState.logging,
    loggingConfig: loggingState.config,
  } satisfies Pick<BootstrapState, "logging" | "loggingConfig">;
  // The sudo trail is one of the audit stream's events, not a parallel protocol (D-099):
  // install the bridge once per process, before the db can run an elevation.
  installSudoAuditBridge(loggingState.logging);

  if (projectConfig === null) {
    return {
      db: null,
      config: null,
      warnings,
      startedAt,
      jobs: null,
      tasks: null,
      workflows: null,
      storage: null,
      ...loggingFields,
    };
  }

  // Binary storage is independent of the database: a refused storage configuration is a
  // warning and a null API, so the rest of the app keeps working (D-053).
  const resolvedStorage = resolveStorage(projectConfig, process.env, projectRoot);
  warnings.push(...resolvedStorage.warnings);
  const storage = resolvedStorage.storage;

  // The environment, not the config alone, decides where data lives (D-068): a deployment
  // sets a Postgres URL and the same build runs there. Every refusal is a warning, so a
  // misconfigured production boot degrades to "no database" instead of crashing.
  const resolved = resolveDbTarget(projectConfig, process.env);
  warnings.push(...resolved.warnings);
  if (resolved.target === null) {
    return {
      db: null,
      config: projectConfig,
      warnings,
      startedAt,
      jobs: null,
      tasks: null,
      workflows: null,
      storage,
      ...loggingFields,
    };
  }
  const target = resolved.target;
  const usesPglite = target.driver === "pglite";

  // Dev-only persistence (D-052): an in-memory PGlite cluster is restored from one snapshot
  // file in the project. A postgres target has no snapshot to read, and must not restore one.
  const devPersistenceEnabled = usesPglite && !isProductionEnvironment();
  const snapshotPath = devDbSnapshotPath(projectRoot);
  let snapshot: Uint8Array | null = null;
  if (devPersistenceEnabled) {
    try {
      snapshot = await readDevDbSnapshot(snapshotPath);
    } catch (error) {
      warnings.push(
        warning(
          "db_snapshot_unreadable",
          `Could not read the dev database snapshot: ${describe(error)}`,
        ),
      );
    }
  }

  let db: FacilisDb;
  try {
    db = await createDb({
      driver: target.driver,
      url: target.url,
      loadSnapshot: snapshot ?? undefined,
      schema: dbSchema,
    });
  } catch (error) {
    if (snapshot === null) {
      warnings.push(warning("db_unavailable", `Could not open the database: ${describe(error)}`));
      return {
        db: null,
        config: projectConfig,
        warnings,
        startedAt,
        jobs: null,
        tasks: null,
        workflows: null,
        storage,
        ...loggingFields,
      };
    }
    // A corrupt or incompatible snapshot must not make the project unbootable: warn and
    // start from an empty cluster instead (the old file is replaced by the next dump).
    // Only pglite ever reads a snapshot (see devPersistenceEnabled), so the retry keeps the
    // resolved driver instead of hard-coding one.
    warnings.push(
      warning(
        "db_snapshot_failed",
        `Could not restore the dev database snapshot, starting empty: ${describe(error)}`,
      ),
    );
    try {
      db = await createDb({
        driver: target.driver,
        url: target.url,
        schema: dbSchema,
      });
    } catch (retryError) {
      warnings.push(
        warning("db_unavailable", `Could not open the database: ${describe(retryError)}`),
      );
      return {
        db: null,
        config: projectConfig,
        warnings,
        startedAt,
        jobs: null,
        tasks: null,
        workflows: null,
        storage,
        ...loggingFields,
      };
    }
  }

  // The dev bootstrap keeps a PGlite project self-contained: migrations -> seed -> app role
  // (D-052). A real Postgres is provisioned out of band by the deploy step; the runtime may
  // even connect as facilis_app, which can neither create roles nor run schema changes.
  if (usesPglite) {
    await bootstrapDevelopmentDatabase(db, projectConfig, warnings);
  } else {
    warnings.push(
      warning(
        "db_migrations_skipped",
        "Postgres target: migrations, roles and views are provisioned by the deploy step, not at boot.",
      ),
    );
    // Views are DDL like migrations: a restricted runtime role cannot create them, so the
    // deploy step owns them and the boot only reports that it skipped the step.
    if (dbViewModules.length > 0) {
      warnings.push(
        warning(
          "view_ddl_skipped",
          "Postgres target: SQL views are provisioned by the deploy step, not at boot.",
        ),
      );
    }
  }

  if (devPersistenceEnabled) {
    installDevDbSnapshotter({
      db,
      projectRoot,
      snapshotPath,
      onError: (error) => {
        // One warning per process is enough: a full disk would otherwise flood the manifest.
        if (!warnings.some((entry) => entry.code === "db_snapshot_write_failed")) {
          warnings.push(
            warning(
              "db_snapshot_write_failed",
              `Could not write the dev database snapshot: ${describe(error)}`,
            ),
          );
        }
      },
    });
  }

  // The queue, manual tasks and workflows all run as facilis_app after the roles/views exist
  // (D-107, D-135); a failure in any of them is a warning and a null service, not a 500.
  const { jobs, tasks, workflows } = await bootRuntimes({
    db,
    tenantId: readDefaultTenantId(),
    projectConfig,
    jobModules,
    workflowModules,
    warnings,
  });

  return {
    db,
    config: projectConfig,
    warnings,
    startedAt,
    jobs,
    tasks,
    workflows,
    storage,
    ...loggingFields,
  };
}

function warning(code: string, message: string): ManifestWarning {
  return { code, message };
}
