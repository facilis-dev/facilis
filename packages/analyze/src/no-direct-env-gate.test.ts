/**
 * D-224 framework gate: no package reads `process.env` outside the documented seams.
 *
 * The runtime resolver is the single place the environment is read for a deployment value; the
 * allowlist below is the complete set of exceptions, each with its reason. It is a ratchet: a file
 * that stops reading its variable must leave the list, and a new reader fails the gate.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { identifierName, memberName, type AstNode } from "./ast/node.ts";
import { walk } from "./ast/walk.ts";
import { loadProjectFiles } from "./fs.ts";
import { createOxcParser } from "./node.ts";

const PARSER = createOxcParser();

/** path (relative to packages/) -> why the direct read is legitimate. */
const ALLOWED: Readonly<Record<string, string>> = {
  "auth/src/sso/login.ts":
    "per-provider secret names are declared in config; this is the injectable default",
  "auth/src/sso/providers.ts": "same seam: the caller passes the environment",
  "nitro/src/prerender-data.ts": "the build swaps NODE_ENV while rendering the prerender pass",
  "nitro/src/runtime/bootstrap.ts": "the boot passes NODE_ENV into the resolvers",
  "nitro/src/runtime/env.ts": "NODE_ENV is the fail-closed production test (D-146)",
  "nitro/src/runtime/http-guard.ts": "injectable default for the production test",
  "nitro/src/runtime/runtime-config-boot.ts": "the one legitimate read of the deployment surface",
  "nitro/src/runtime/sso.ts": "injectable default for the production test",
  "nitro/src/runtime/telemetry/config.ts": "injectable default for the build/runtime switch",
  "nitro/src/runtime/telemetry/rum-build-config.ts": "build-time RUM switch",
  "nitro/src/runtime/telemetry/runtime.ts": "injectable default for the export target",
  "nitro/src/vite-dev-metrics.ts": "build/serve plugin switch (D-200)",
  "nitro/src/vite-public.ts": "build plugin: resolves the public section once per build (D-224)",
  "nitro/src/vite-rum.ts": "build plugin switch (D-209)",
};

function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate the repo root from " + import.meta.url);
    current = parent;
  }
}

function isProcessEnv(node: AstNode): boolean {
  return (
    node.type === "MemberExpression" &&
    memberName(node) === "env" &&
    identifierName(node["object"]) === "process"
  );
}

function readers(): string[] {
  const files = loadProjectFiles(join(repositoryRoot(), "packages"));
  const found: string[] = [];
  for (const [path, source] of files) {
    if (path.includes(".test.") || path.includes(".spec.")) continue;
    // The loader follows the framework overlay; only the package sources matter here.
    if (path.includes("node_modules/")) continue;
    const parsed = PARSER.parse(path, source);
    let reads = false;
    walk(parsed.program, (node) => {
      if (isProcessEnv(node)) reads = true;
    });
    if (reads) found.push(path);
  }
  return found.toSorted();
}

describe("framework env reads (D-224)", () => {
  it("keeps every direct process.env read on the documented allowlist", () => {
    const found = readers();
    const unexpected = found.filter((path) => ALLOWED[path] === undefined);
    expect(
      unexpected,
      "add the file to ALLOWED with a reason, or read the value through the runtime resolver",
    ).toEqual([]);
  });

  it("does not keep a stale allowlist entry", () => {
    const found = new Set(readers());
    const stale = Object.keys(ALLOWED).filter((path) => !found.has(path));
    expect(stale, "the file no longer reads process.env: remove it from ALLOWED").toEqual([]);
  });
});
