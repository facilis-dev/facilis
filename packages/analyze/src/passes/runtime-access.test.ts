import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildConfigFacts } from "./config.ts";
import {
  RUNTIME_KEY_SERVER_ONLY,
  RUNTIME_KEY_UNDECLARED,
  RUNTIME_KEY_UNSET,
  RUNTIME_KEY_UNUSED,
  VITE_ENV_DIRECT,
  runtimeConfigDiagnostics,
} from "./runtime-access.ts";
import { RUNTIME_KEY_MISSING } from "./runtime-requirements.ts";

const PARSER = createOxcParser();
const HEADER = 'import { defineConfig } from "@facilis.dev/core";\n';

function config(runtime: string, publicSection?: string): string {
  const pub = publicSection === undefined ? "" : ", public: " + publicSection;
  return HEADER + "export default defineConfig({ runtime: " + runtime + pub + " });";
}

function scan(files: Record<string, string>) {
  const graph = createModuleGraph({ files: new Map(Object.entries(files)), parser: PARSER });
  return runtimeConfigDiagnostics(graph, buildConfigFacts(graph).facts);
}

const RUNTIME = '{ databaseMode: "pglite", logLevel: "info", storageDriver: "local" }';

describe("runtime read sites (D-224)", () => {
  it("reads ctx.runtime, runtimeEnv() and simple destructuring", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME),
      "server/reads.ts": [
        "export const a = ctx.runtime.databaseMode;",
        "export const b = runtimeEnv().logLevel;",
        "const { logLevel } = ctx.runtime;",
        "export const c = logLevel;",
      ].join("\n"),
    });
    expect(diagnostics).toEqual([]);
  });

  it("reports a read key that is not declared", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME),
      "server/reads.ts": "export const tenant = ctx.runtime.tenantId;",
    });
    const undeclared = diagnostics.filter((entry) => entry.code === RUNTIME_KEY_UNDECLARED);
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]?.message).toContain("tenantId");
  });

  it("ignores computed keys, which cannot be named statically", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME),
      "server/reads.ts": "export const pick = (key: string) => ctx.runtime[key];",
    });
    expect(diagnostics.filter((entry) => entry.code === RUNTIME_KEY_UNDECLARED)).toEqual([]);
  });

  it("treats a dynamic declaration as declared, never as unset", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(
        '{ databaseMode: process.env.MODE, logLevel: "info", storageDriver: "local" }',
      ),
      "server/reads.ts": "export const mode = ctx.runtime.databaseMode;",
    });
    expect(diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });
});

describe("runtime-key-unset and runtime-key-unused", () => {
  it("flags a declaration with neither a literal nor a secret marker", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(
        '{ databaseMode: undefined, logLevel: "info", storageDriver: "local" }',
      ),
      "server/reads.ts": "export const mode = ctx.runtime.databaseMode;",
    });
    expect(diagnostics.map((entry) => entry.code)).toContain(RUNTIME_KEY_UNSET);
    expect(diagnostics.find((entry) => entry.code === RUNTIME_KEY_UNSET)?.message).toContain(
      "databaseMode",
    );
  });

  it("warns on an app-defined key nobody reads, never on a framework key", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(
        '{ databaseMode: "pglite", logLevel: "info", storageDriver: "local", supportEmail: "help@a.test" }',
      ),
      "server/reads.ts":
        "export const a = ctx.runtime.databaseMode; export const b = ctx.runtime.logLevel;",
    });
    const unused = diagnostics.filter((entry) => entry.code === RUNTIME_KEY_UNUSED);
    expect(unused).toHaveLength(1);
    expect(unused[0]?.severity).toBe("warning");
    expect(unused[0]?.message).toContain("supportEmail");
  });
});

describe("runtime-key-missing (D-224)", () => {
  it("prints the exact line to paste for every always-on requirement", () => {
    const diagnostics = scan({ "facilis.config.ts": config('{ logLevel: "info" }') });
    const missing = diagnostics.filter((entry) => entry.code === RUNTIME_KEY_MISSING);
    // databaseMode and storageDriver: both are read at every boot.
    expect(missing).toHaveLength(2);
    const text = missing.map((entry) => entry.message).join("\n");
    expect(text).toContain('add: databaseMode: "pglite",');
    expect(text).toContain('add: storageDriver: "local",');
  });

  it("only requires S3 keys when storageDriver is s3", () => {
    const s3 = scan({
      "facilis.config.ts": config(
        '{ databaseMode: "pglite", logLevel: "info", storageDriver: "s3" }',
      ),
    }).filter((entry) => entry.code === RUNTIME_KEY_MISSING);
    expect(s3).toHaveLength(4);
    const s3Text = s3.map((entry) => entry.message).join("\n");
    expect(s3Text).toContain("add: s3Bucket: null,");
    expect(s3Text).toContain("add: s3Region: null,");
    expect(s3Text).toContain("add: s3AccessKeyId: { secret: true },");
    expect(s3Text).toContain("add: s3SecretAccessKey: { secret: true },");

    const local = scan({
      "facilis.config.ts": config(
        '{ databaseMode: "pglite", logLevel: "info", storageDriver: "local" }',
      ),
    }).filter((entry) => entry.code === RUNTIME_KEY_MISSING);
    expect(local).toEqual([]);
  });

  it("requires the telemetry keys only when telemetry is enabled", () => {
    const missing = scan({
      "facilis.config.ts": config(
        '{ databaseMode: "pglite", logLevel: "info", storageDriver: "local", telemetryEnabled: true }',
      ),
    }).filter((entry) => entry.code === RUNTIME_KEY_MISSING);
    expect(missing).toHaveLength(2);
    expect(missing.map((entry) => entry.message).join("\n")).toContain(
      "add: telemetryTenantKey: { secret: true },",
    );

    const off = scan({
      "facilis.config.ts": config(
        '{ databaseMode: "pglite", logLevel: "info", storageDriver: "local", telemetryEnabled: false }',
      ),
    }).filter((entry) => entry.code === RUNTIME_KEY_MISSING);
    expect(off).toEqual([]);
  });

  it("never asserts missing when the section is a spread", () => {
    const missing = scan({
      "facilis.config.ts": config('{ ...base, databaseMode: "pglite", logLevel: "info" }'),
      "server/reads.ts": "export const tenant = ctx.runtime.tenantId;",
    }).filter(
      (entry) => entry.code === RUNTIME_KEY_MISSING || entry.code === RUNTIME_KEY_UNDECLARED,
    );
    expect(missing).toEqual([]);
  });
});

describe("runtime-key-server-only", () => {
  it("rejects ctx.runtime in client-reachable src/", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME),
      "src/app.tsx": "export const level = ctx.runtime.logLevel;",
    });
    const errors = diagnostics.filter((entry) => entry.severity === "error");
    expect(errors.map((entry) => entry.code)).toEqual([RUNTIME_KEY_SERVER_ONLY]);
  });

  it("allows publicConfig() in src/ and server/", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME, '{ apiBaseUrl: "/api" }'),
      "src/api.ts": "export const base = publicConfig().apiBaseUrl;",
      "server/api.ts": "export const base = publicConfig().apiBaseUrl;",
      "server/reads.ts":
        "export const a = ctx.runtime.databaseMode; export const b = ctx.runtime.logLevel;",
    });
    expect(diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });

  it("rejects a public key read through ctx.runtime", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME, '{ apiBaseUrl: "/api" }'),
      "server/reads.ts": "export const base = ctx.runtime.apiBaseUrl;",
    });
    const errors = diagnostics.filter((entry) => entry.severity === "error");
    expect(errors.map((entry) => entry.code)).toEqual([RUNTIME_KEY_SERVER_ONLY]);
    expect(errors[0]?.message).toContain("publicConfig()");
  });
});

describe("vite-env-direct", () => {
  it("warns in project src/ and server/, never for vite.config.ts or dependencies", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME),
      "src/env.ts": "export const url = import.meta.env.VITE_API_URL;",
      "server/env.ts": "export const url = import.meta.env.VITE_API_URL;",
      "vite.config.ts": "export default { url: import.meta.env.VITE_API_URL };",
      "node_modules/lib/src/env.ts": "export const url = import.meta.env.VITE_API_URL;",
    }).filter((entry) => entry.code === VITE_ENV_DIRECT);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((entry) => entry.severity === "warning")).toBe(true);
  });
});

describe("runtime diagnostics scope", () => {
  it("says nothing when the project has no config file (static template)", () => {
    const diagnostics = scan({ "src/app.tsx": "export const value = ctx.runtime.logLevel;" });
    expect(diagnostics).toEqual([]);
  });

  it("passes a fully declared and read surface", () => {
    const diagnostics = scan({
      "facilis.config.ts": config(RUNTIME, '{ apiBaseUrl: "/api" }'),
      "server/reads.ts":
        "export const a = ctx.runtime.databaseMode; export const b = runtimeEnv().logLevel;",
      "src/api.ts": "export const base = publicConfig().apiBaseUrl;",
    });
    expect(diagnostics).toEqual([]);
  });
});
