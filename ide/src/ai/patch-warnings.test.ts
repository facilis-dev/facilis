import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis.dev/ai";
import { scanPatchWarnings } from "./patch-warnings";

function update(path: string, content: string): FilePatch {
  return { path, action: "update", content };
}

describe("scanPatchWarnings", () => {
  it("flags Node globals in client files", () => {
    const warnings = scanPatchWarnings([
      update(
        "src/App.tsx",
        "export const key = process.env.KEY;\nexport const buf = Buffer.from('x');\nexport const dir = __dirname;",
      ),
    ]);
    expect(warnings).toEqual([
      { path: "src/App.tsx", rule: "node-global", symbol: "process" },
      { path: "src/App.tsx", rule: "node-global", symbol: "Buffer" },
      { path: "src/App.tsx", rule: "node-global", symbol: "__dirname" },
    ]);
  });

  it("reports one warning per symbol at its first occurrence", () => {
    const warnings = scanPatchWarnings([
      update(
        "components/Chart.tsx",
        "process.env.A; process.env.B; Buffer.from('x'); Buffer.from('y');",
      ),
    ]);
    expect(warnings).toEqual([
      { path: "components/Chart.tsx", rule: "node-global", symbol: "process" },
      { path: "components/Chart.tsx", rule: "node-global", symbol: "Buffer" },
    ]);
  });

  it("flags require() itself and the server module it loads", () => {
    const warnings = scanPatchWarnings([update("src/dev.ts", 'const fs = require("fs");')]);
    expect(warnings).toEqual([
      { path: "src/dev.ts", rule: "node-global", symbol: "require" },
      { path: "src/dev.ts", rule: "server-import", symbol: "fs" },
    ]);
  });

  it("flags node: and server-only package specifiers", () => {
    const content = [
      'import fs from "node:fs";',
      'import path from "path";',
      'import { db } from "@facilis.dev/db";',
      'import { auth } from "@facilis.dev/auth";',
      'import { nitro } from "@facilis.dev/nitro";',
      'import { drizzle } from "drizzle-orm";',
      'import { spawn } from "child_process";',
      'import "os";',
    ].join("\n");
    const warnings = scanPatchWarnings([update("src/server-api.ts", content)]);
    expect(warnings.map((warning) => warning.symbol)).toEqual([
      "node:fs",
      "path",
      "@facilis.dev/db",
      "@facilis.dev/auth",
      "@facilis.dev/nitro",
      "drizzle-orm",
      "child_process",
      "os",
    ]);
    expect(warnings.every((warning) => warning.rule === "server-import")).toBe(true);
  });

  it("does not flag browser-safe imports", () => {
    // The contract lists exact server specifiers, so a Node subpath such as
    // "fs/promises" is outside this rule (the validator owns real module safety).
    const content = [
      'import { useState } from "react";',
      'import { z } from "zod";',
      'import { fileDiff } from "./diff";',
      'import { readFile } from "fs/promises";',
    ].join("\n");
    expect(scanPatchWarnings([update("src/App.tsx", content)])).toEqual([]);
  });

  it("leaves server, db, locales, lib and root config untouched", () => {
    const patches: FilePatch[] = [
      update("server/routes/x.get.ts", "export const s = process.env.SECRET;"),
      update("db/schema.ts", 'import fs from "node:fs";'),
      update("locales/en.ts", "export const l = process.env.LOCALE;"),
      update("lib/db.ts", "export const d = process.env.DB;"),
      update("facilis.config.ts", "export const c = process.env.CONFIG;"),
    ];
    expect(scanPatchWarnings(patches)).toEqual([]);
  });

  it("ignores mentions in comments", () => {
    const content = [
      "// process.env is not available in the browser",
      '/* import fs from "node:fs" */',
      "/** Buffer, require('child_process') and __dirname are server-only */",
      "export const safe = 1;",
    ].join("\n");
    expect(scanPatchWarnings([update("src/safe.ts", content)])).toEqual([]);
  });

  it("does not treat // inside a string as a comment", () => {
    const content = 'const url = "https://example.com"; const key = process.env.KEY;';
    expect(scanPatchWarnings([update("src/fetch.ts", content)])).toEqual([
      { path: "src/fetch.ts", rule: "node-global", symbol: "process" },
    ]);
  });

  it("normalizes a leading ./ for scope but reports the patch path", () => {
    expect(scanPatchWarnings([update("./src/App.tsx", "process.env.KEY;")])).toEqual([
      { path: "./src/App.tsx", rule: "node-global", symbol: "process" },
    ]);
  });

  it("skips delete patches and scans create patches", () => {
    const deleted: FilePatch = { path: "src/old.ts", action: "delete" };
    expect(scanPatchWarnings([deleted])).toEqual([]);
    expect(
      scanPatchWarnings([{ path: "src/new.ts", action: "create", content: "process.env.KEY;" }]),
    ).toEqual([{ path: "src/new.ts", rule: "node-global", symbol: "process" }]);
  });

  it("keeps input order across patches and deduplicates repeated paths", () => {
    const warnings = scanPatchWarnings([
      update("src/b.ts", "Buffer.from('x');"),
      update("src/a.ts", "process.env.KEY;"),
      update("src/b.ts", "Buffer.from('x');"),
    ]);
    expect(warnings).toEqual([
      { path: "src/b.ts", rule: "node-global", symbol: "Buffer" },
      { path: "src/a.ts", rule: "node-global", symbol: "process" },
    ]);
  });

  it("scans export-from specifiers too", () => {
    const warnings = scanPatchWarnings([
      update("src/barrel.ts", 'export { x } from "fs";\nexport * from "@facilis.dev/db";'),
    ]);
    expect(warnings.map((warning) => warning.symbol)).toEqual(["fs", "@facilis.dev/db"]);
  });

  it("orders warnings by first occurrence across rules", () => {
    const warnings = scanPatchWarnings([
      update("src/App.tsx", 'import { db } from "@facilis.dev/db";\nexport const x = process.env.X;'),
    ]);
    expect(warnings).toEqual([
      { path: "src/App.tsx", rule: "server-import", symbol: "@facilis.dev/db" },
      { path: "src/App.tsx", rule: "node-global", symbol: "process" },
    ]);
  });
});
