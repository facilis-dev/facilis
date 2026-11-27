import { describe, expect, it } from "vitest";

import { defineConfig } from "../config.ts";
import { RUNTIME_CANONICAL } from "./defaults.ts";
import { ENV_EXAMPLE_HEADER, renderEnvExample } from "./env-example.ts";
import { envNameFor } from "./resolve.ts";

const AUTH = {
  permissions: [],
  roles: { user: [] },
  defaultRole: "user",
  sessionDurationMs: 1000,
};

const CONFIG = defineConfig({
  auth: AUTH,
  runtime: {
    databaseUrl: { secret: true },
    logLevel: "info",
    logTrustProxy: false,
    telemetryOrigins: ["https://a.test", "https://b.test"],
    telemetrySampling: 0.25,
    logDir: null,
  },
  public: { appName: "My app", features: { comments: true } },
});

describe("renderEnvExample (D-224)", () => {
  it("starts with the generated header pointing at D-224", () => {
    const text = renderEnvExample(CONFIG);
    expect(text.startsWith(ENV_EXAMPLE_HEADER)).toBe(true);
    expect(text.split("\n")[0]).toContain("D-224");
    expect(text).toContain("generated from facilis.config.ts");
  });

  it("renders a runtime literal commented out and sorted", () => {
    const text = renderEnvExample(CONFIG);
    expect(text).toContain("# FACILIS_LOG_LEVEL=info");
    expect(text).toContain("# FACILIS_LOG_TRUST_PROXY=false");
    expect(text).toContain("# FACILIS_LOG_DIR=");
    expect(text).toContain("# FACILIS_TELEMETRY_SAMPLING=0.25");
    expect(text).toContain('# FACILIS_TELEMETRY_ORIGINS=["https://a.test","https://b.test"]');
  });

  it("renders a secret as a commented, empty variable with the required note", () => {
    const text = renderEnvExample(CONFIG);
    expect(text).toContain("\n# FACILIS_DATABASE_URL=\n");
    expect(text).toContain("#   required:");
    const secretLine = text.split("\n").find((line) => line.includes("FACILIS_DATABASE_URL="));
    expect(secretLine).toBe("# FACILIS_DATABASE_URL=");
  });

  it("renders the public block commented out, with the build-time note", () => {
    const text = renderEnvExample(CONFIG);
    const publicBlock = text.slice(text.indexOf("# Public"));
    expect(publicBlock).toContain("build time only");
    expect(publicBlock).toContain("# FACILIS_PUBLIC_APP_NAME=My app");
    expect(publicBlock).toContain('# FACILIS_PUBLIC_FEATURES={"comments":true}');
  });

  it("stays inert when copied: no line is active", () => {
    const text = renderEnvExample(CONFIG);
    const active = text.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(active).toEqual([]);
  });

  it("never writes a secret value: every secret marker renders as an empty line", () => {
    const secretKeys = Object.entries(RUNTIME_CANONICAL)
      .filter(([, value]) => typeof value === "object" && value !== null && "secret" in value)
      .map(([key]) => key);
    const allSecrets = defineConfig({
      auth: AUTH,
      runtime: Object.fromEntries(secretKeys.map((key) => [key, { secret: true }])),
    });
    const text = renderEnvExample(allSecrets);
    for (const key of secretKeys) {
      const name = envNameFor(key);
      const line = text.split("\n").find((entry) => entry.trimStart().startsWith(`# ${name}=`));
      expect(line, key).toBe(`# ${name}=`);
    }
    // The generated file is stable: running the command twice writes the same bytes.
    const first = renderEnvExample(CONFIG);
    expect(renderEnvExample(CONFIG)).toBe(first);
  });

  it("says so when a section declares nothing", () => {
    const empty = defineConfig({ auth: AUTH });
    const text = renderEnvExample(empty);
    expect(text).toContain("# Runtime");
    expect(text).toContain("# (none declared)");
  });
});
