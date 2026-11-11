import { describe, expect, it } from "vitest";

import type { JobModule } from "./contracts.ts";
import { buildJobRegistry } from "./definitions.ts";

function moduleOf(file: string, definition: unknown): JobModule {
  return { file, definition };
}

function validDefinition(name: string) {
  return {
    name,
    input: { safeParse: () => ({ success: true, data: {} }) },
    output: { safeParse: () => ({ success: true, data: {} }) },
    dbTables: [],
    run: async () => ({}),
  };
}

describe("buildJobRegistry", () => {
  it("indexes valid definitions by name", () => {
    const report = validDefinition("report");
    const purge = validDefinition("purge");
    const registry = buildJobRegistry([
      moduleOf("server/jobs/report.ts", report),
      moduleOf("server/jobs/purge.ts", purge),
    ]);
    expect([...registry.definitions.keys()]).toEqual(["report", "purge"]);
    expect(registry.definitions.get("report")).toBe(report);
    expect(registry.warnings).toEqual([]);
  });

  it("skips an invalid default export with a warning naming the file", () => {
    const registry = buildJobRegistry([
      moduleOf("server/jobs/broken.ts", { name: "no-schemas" }),
      moduleOf("server/jobs/ok.ts", validDefinition("ok")),
    ]);
    expect([...registry.definitions.keys()]).toEqual(["ok"]);
    expect(registry.warnings).toHaveLength(1);
    expect(registry.warnings[0]).toMatchObject({
      code: "job_definition_invalid",
      sourceFile: "server/jobs/broken.ts",
    });
    expect(registry.warnings[0]?.message).toContain("server/jobs/broken.ts");
  });

  it("keeps the first definition and warns about a duplicate", () => {
    const first = validDefinition("report");
    const second = validDefinition("report");
    const registry = buildJobRegistry([
      moduleOf("server/jobs/first.ts", first),
      moduleOf("server/jobs/second.ts", second),
    ]);
    expect(registry.definitions.get("report")).toBe(first);
    expect(registry.warnings).toHaveLength(1);
    expect(registry.warnings[0]).toMatchObject({
      code: "job_definition_invalid",
      sourceFile: "server/jobs/second.ts",
    });
    expect(registry.warnings[0]?.message).toContain("Duplicate");
  });

  it("accepts an empty module list", () => {
    const registry = buildJobRegistry([]);
    expect([...registry.definitions.keys()]).toEqual([]);
    expect(registry.warnings).toEqual([]);
  });
});
