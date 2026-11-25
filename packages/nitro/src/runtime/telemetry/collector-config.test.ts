/**
 * The operator collector reference configs (docs/telemetry/) are part of the privacy
 * contract (D-203 §7, D-209): their redaction allowlists must not drift from the
 * framework vocabulary, and IP truncation must stay present. The app-side scrub is the
 * first gate; these configs are the operator-side defense in depth, so a vocabulary
 * change that forgets them fails here.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  LEGACY_SPAN_KEYS,
  RESOURCE_ATTRIBUTE_ALLOWLIST,
  SPAN_ATTRIBUTE_ALLOWLIST,
} from "./ingest/scrub.ts";

const CONFIG_DIR = new URL("../../../../../docs/telemetry/", import.meta.url);
// Collector-side only: the truncated client address the transform processor keeps.
const CLIENT_ADDRESS = "client.address";
const EXPECTED_SPAN_KEYS = new Set<string>([
  ...SPAN_ATTRIBUTE_ALLOWLIST,
  ...LEGACY_SPAN_KEYS.keys(),
  CLIENT_ADDRESS,
]);
const EXPECTED_RESOURCE_KEYS = [...RESOURCE_ATTRIBUTE_ALLOWLIST];

function readConfig(name: string): Promise<string> {
  return readFile(new URL(name, CONFIG_DIR), "utf8");
}

/** Extract a River string-array attribute (allowed_keys); comments carry no quotes. */
function riverStringArray(source: string, attribute: string): string[] {
  const block = source.match(new RegExp(attribute + "\\s*=\\s*\\[([\\s\\S]*?)\\]"));
  expect(block, attribute).not.toBeNull();
  return [...(block?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
}

interface OtelcolConfig {
  processors: {
    redaction: { allow_all_keys: boolean; allowed_keys: string[] };
    transform: { trace_statements: { context: string; statements: string[] }[] };
  };
  service: { pipelines: { traces: { processors: string[] } } };
}

describe("otelcol.yaml reference config", () => {
  it("parses as YAML and keeps the redaction allowlist fail-closed and in sync", async () => {
    const config = parse(await readConfig("otelcol.yaml")) as OtelcolConfig;
    expect(config.processors.redaction.allow_all_keys).toBe(false);
    expect([...new Set(config.processors.redaction.allowed_keys)].sort()).toEqual(
      [...EXPECTED_SPAN_KEYS].sort(),
    );
  });

  it("keeps only the framework resource attributes", async () => {
    const config = parse(await readConfig("otelcol.yaml")) as OtelcolConfig;
    const resource = config.processors.transform.trace_statements.find(
      (group) => group.context === "resource",
    );
    const keepKeys = resource?.statements.find((s) =>
      s.startsWith("keep_keys(resource.attributes,"),
    );
    expect(keepKeys).toBeDefined();
    const keys = [...(keepKeys ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...EXPECTED_RESOURCE_KEYS].sort());
  });

  it("truncates client IPs to /24 (IPv4) and /48 (IPv6) before the allowlist runs", async () => {
    const config = parse(await readConfig("otelcol.yaml")) as OtelcolConfig;
    const span = config.processors.transform.trace_statements.find(
      (group) => group.context === "span",
    );
    const statements = (span?.statements ?? []).join("\n");
    expect(statements).toContain('attributes["' + CLIENT_ADDRESS + '"]');
    // $$ survives collector env substitution and reaches OTTL as the $1 capture.
    expect(statements).toContain("$$1.0/24");
    expect(statements).toContain("$$1::/48");
    const order = config.service.pipelines.traces.processors;
    expect(order.indexOf("transform")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("transform")).toBeLessThan(order.indexOf("redaction"));
  });
});

describe("alloy.river reference config", () => {
  it("keeps the redaction allowlist fail-closed and in sync with the vocabulary", async () => {
    const source = await readConfig("alloy.river");
    expect(source).toMatch(/allow_all_keys\s*=\s*false/);
    expect(riverStringArray(source, "allowed_keys").sort()).toEqual([...EXPECTED_SPAN_KEYS].sort());
  });

  it("keeps only the framework resource attributes", async () => {
    const source = await readConfig("alloy.river");
    expect(source).toContain("keep_keys(resource.attributes,");
    for (const key of EXPECTED_RESOURCE_KEYS) {
      expect(source, key).toContain('\\"' + key + '\\"');
    }
  });

  it("truncates client IPs to /24 (IPv4) and /48 (IPv6) and chains into redaction", async () => {
    const source = await readConfig("alloy.river");
    // River has no collector-style env substitution: the OTTL capture is a plain $1.
    expect(source).toContain("$1.0/24");
    expect(source).toContain("$1::/48");
    expect(source).toContain("otelcol.processor.transform.facilis.input");
    expect(source).toContain("otelcol.processor.redaction.facilis.input");
    expect(source).toContain("otelcol.processor.batch.facilis.input");
  });
});
