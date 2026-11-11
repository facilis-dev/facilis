import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineJob, isJobDefinition, JobError, serializeJobData, unavailableJobs } from "./jobs.ts";

const VALID = {
  name: "purge-completed-todos",
  input: z.object({ olderThanDays: z.number().int().positive() }),
  output: z.object({ deleted: z.number().int() }),
  dbTables: ["todos"],
  run: () => ({ deleted: 0 }),
};

describe("defineJob", () => {
  it("returns the definition unchanged when it is valid", () => {
    const definition = defineJob(VALID);

    expect(definition).toBe(VALID);
    expect(definition.name).toBe("purge-completed-todos");
  });

  it("rejects names that are not enqueue-safe identifiers", () => {
    expect(() => defineJob({ ...VALID, name: "Purge Todos" })).toThrow(TypeError);
    expect(() => defineJob({ ...VALID, name: "" })).toThrow(TypeError);
    expect(() => defineJob({ ...VALID, name: "-leading" })).toThrow(TypeError);
  });

  it("requires both schemas and a run function", () => {
    expect(() => defineJob({ ...VALID, input: undefined as never })).toThrow(/input/);
    expect(() => defineJob({ ...VALID, output: undefined as never })).toThrow(/output/);
    expect(() => defineJob({ ...VALID, run: undefined as never })).toThrow(/run/);
  });

  it("rejects non-positive overrides and invalid dbTables", () => {
    expect(() => defineJob({ ...VALID, maxAttempts: 0 })).toThrow(/maxAttempts/);
    expect(() => defineJob({ ...VALID, timeoutMs: -1 })).toThrow(/timeoutMs/);
    expect(() => defineJob({ ...VALID, dbTables: [""] })).toThrow(/dbTables/);
    expect(() => defineJob({ ...VALID, dbTables: "todos" as never })).toThrow(/dbTables/);
  });

  it("requires dbTables, accepting an empty declaration", () => {
    expect(() => defineJob({ ...VALID, dbTables: undefined as never })).toThrow(/dbTables/);
    expect(defineJob({ ...VALID, dbTables: [] }).dbTables).toEqual([]);
  });

  it("rejects a non-boolean rawSql flag", () => {
    expect(() => defineJob({ ...VALID, rawSql: "yes" as never })).toThrow(/rawSql/);
    expect(defineJob({ ...VALID, rawSql: true }).rawSql).toBe(true);
  });
});

describe("isJobDefinition", () => {
  it("accepts a defineJob result and rejects arbitrary module exports", () => {
    expect(isJobDefinition(defineJob(VALID))).toBe(true);
    expect(isJobDefinition({ name: "x" })).toBe(false);
    expect(isJobDefinition(null)).toBe(false);
    // The declaration is enforced at runtime, so a definition without dbTables is not one.
    expect(isJobDefinition({ ...VALID, dbTables: undefined })).toBe(false);
    // A default export that is a bare run function is not a definition.
    expect(isJobDefinition(() => undefined)).toBe(false);
  });
});

describe("unavailableJobs", () => {
  it("rejects every call with a job_unavailable JobError", async () => {
    const jobs = unavailableJobs();
    const calls: Array<() => Promise<unknown>> = [
      () => jobs.enqueue("purge", {}),
      () => jobs.get("id"),
      () => jobs.list(),
      () => jobs.queue(),
      () => jobs.running(),
      () => jobs.cancel("id"),
      () => jobs.stats(),
    ];

    const results = await Promise.allSettled(calls.map((call) => call()));
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(JobError);
        expect((result.reason as JobError).code).toBe("job_unavailable");
      }
    }
  });
});

describe("serializeJobData", () => {
  it("returns exactly the JSON round-trip of the value", () => {
    const value = { id: "a", nested: [1, true, null], text: "x" };

    expect(serializeJobData(value, "job_invalid_input")).toEqual(value);
    // A Date is serialized as an ISO string, so the job receives a string, not a Date.
    expect(serializeJobData({ at: new Date(0) }, "job_invalid_input")).toEqual({
      at: "1970-01-01T00:00:00.000Z",
    });
  });

  it("throws a coded JobError for values JSON cannot carry", () => {
    expect(() => serializeJobData(undefined, "job_invalid_input")).toThrow(JobError);
    expect(() => serializeJobData(10n, "job_invalid_output")).toThrow(JobError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeJobData(circular, "job_invalid_input")).toThrow(JobError);

    try {
      serializeJobData(undefined, "job_invalid_output");
    } catch (error) {
      expect(error).toBeInstanceOf(JobError);
      expect((error as JobError).code).toBe("job_invalid_output");
    }
  });
});
