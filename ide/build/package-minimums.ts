// The released @facilis.dev/* versions, read at build time (D-198).
//
// Node code, like vite.deployment.ts: the app bundle must never import it. The IDE's
// per-package minimums are the versions committed in packages/*/package.json — not an
// environment variable and not a lockstep number, because the packages may diverge.

import fs from "node:fs";
import path from "node:path";

/**
 * Every non-private @facilis.dev/* package's released version, name -> version.
 * A package without a version is a build bug (it would compile a hole into the
 * minimum table), so this fails loudly instead of skipping silently.
 */
export function readPackageMinimums(packagesDir: string): Record<string, string> {
  const table: Record<string, string> = {};
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
      private?: unknown;
    };
    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || !manifest.name.startsWith("@facilis.dev/")) continue;
    if (typeof manifest.version !== "string" || manifest.version === "") {
      throw new Error("package has no released version: " + manifestPath);
    }
    table[manifest.name] = manifest.version;
  }
  // Stable key order: the compiled define is a build artifact and must not churn with
  // readdir order.
  return Object.fromEntries(Object.entries(table).toSorted(([a], [b]) => a.localeCompare(b)));
}
