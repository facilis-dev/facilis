import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_JOBS_CONFIG, type ManifestWarning } from "@facilis/core";
import { createDb, type FacilisDb } from "@facilis/db";

import type { JobModule } from "./contracts.ts";
import { bootJobs } from "./boot.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Structural schema stub: the executor never validates, so no zod is needed here. */
const schema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };

function validModule(name: string): JobModule {
  return {
    file: `server/jobs/${name}.ts`,
    definition: { name, input: schema, output: schema, dbTables: [], run: async () => ({}) },
  };
}

function codes(warnings: readonly ManifestWarning[]): string[] {
  return warnings.map((warning) => warning.code);
}

describe("bootJobs", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    // An empty cluster has no facilis_jobs table: the persist fallback path is real here.
    db = await createDb();
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("falls back to the in-memory store with jobs_table_missing when the table is absent", async () => {
    const warnings: ManifestWarning[] = [];
    const runtime = await bootJobs({
      db,
      jobsConfig: { ...DEFAULT_JOBS_CONFIG, persist: true },
      modules: [validModule("ping")],
      tenantId: TENANT_ID,
      warnings,
    });
    try {
      expect(runtime).not.toBeNull();
      expect(runtime?.api).toBeDefined();
      expect(codes(warnings)).toContain("jobs_table_missing");
    } finally {
      await runtime?.stop();
    }
  });

  it("uses the in-memory store silently when persist is false", async () => {
    const warnings: ManifestWarning[] = [];
    const runtime = await bootJobs({
      db,
      jobsConfig: { ...DEFAULT_JOBS_CONFIG, persist: false },
      modules: [validModule("ping")],
      tenantId: TENANT_ID,
      warnings,
    });
    try {
      expect(runtime).not.toBeNull();
      expect(warnings).toEqual([]);
    } finally {
      await runtime?.stop();
    }
  });

  it("reports invalid and duplicate definitions but still boots", async () => {
    const warnings: ManifestWarning[] = [];
    const runtime = await bootJobs({
      db,
      jobsConfig: { ...DEFAULT_JOBS_CONFIG, persist: false },
      modules: [
        { file: "server/jobs/broken.ts", definition: 42 },
        validModule("ping"),
        validModule("ping"),
      ],
      tenantId: TENANT_ID,
      warnings,
    });
    try {
      expect(runtime).not.toBeNull();
      expect(codes(warnings).filter((code) => code === "job_definition_invalid")).toHaveLength(2);
    } finally {
      await runtime?.stop();
    }
  });

  it("keeps an empty registry valid: no definitions is a normal project state", async () => {
    const warnings: ManifestWarning[] = [];
    const runtime = await bootJobs({
      db,
      jobsConfig: { ...DEFAULT_JOBS_CONFIG, persist: false },
      modules: [],
      tenantId: TENANT_ID,
      warnings,
    });
    try {
      expect(runtime).not.toBeNull();
      expect(warnings).toEqual([]);
    } finally {
      await runtime?.stop();
    }
  });
});
