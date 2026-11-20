// Per-package framework minimums: the pure half of the D-198 boot gate.
//
// A generated project pins each @facilis.dev/* dependency to an exact released version
// (D-166/D-198). This module decides whether a project's pins satisfy the minimums this
// IDE build compiled in, and rewrites the pins that do not. Pure: no VFS, no React — the
// caller supplies the parsed package.json and the minimum table.
//
// Only exact x.y.z pins are judged. A file:/workspace:/link: spec (the dev-local path,
// D-196), a range, an npm: alias or a prerelease is something the IDE cannot reason about
// as a released version, so it passes: the gate must never block what it cannot order.

import { compareVersions } from "./updates";

/** One framework dependency pinned below its built-in minimum. */
export interface FrameworkPin {
  name: string;
  pinned: string;
  minimum: string;
}

export interface FrameworkPinCheck {
  status: "ok" | "update-required";
  below: FrameworkPin[];
}

/** An exact released version: no range, no prerelease suffix, no protocol. */
const EXACT_PIN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

const DEP_FIELDS = ["dependencies", "devDependencies"] as const;

/** Parse a package.json body; null when absent or malformed (admission handles those). */
export function parsePackageJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function depMaps(pkg: unknown): Array<Record<string, unknown>> {
  if (pkg === null || typeof pkg !== "object") return [];
  const out: Array<Record<string, unknown>> = [];
  for (const field of DEP_FIELDS) {
    const value = (pkg as Record<string, unknown>)[field];
    if (value !== null && typeof value === "object") out.push(value as Record<string, unknown>);
  }
  return out;
}

/** Whether a spec is an exact pin this build can order against a minimum. */
function judgeable(name: string, spec: unknown, minimums: Record<string, string>): string | null {
  if (!name.startsWith("@facilis.dev/")) return null;
  if (typeof spec !== "string" || !EXACT_PIN.test(spec)) return null;
  const minimum = minimums[name];
  // A pinned package this build has no minimum for passes (forward compat).
  if (minimum === undefined) return null;
  return minimum;
}

/**
 * Check a project's framework pins against the built-in minimums. A missing or invalid
 * package.json passes (admission handles invalid projects elsewhere); a project without
 * framework deps passes (the static template). Only exact pins below their package's
 * own minimum require an update.
 */
export function checkFrameworkPins(
  projectPackageJson: unknown,
  minimums: Record<string, string>,
): FrameworkPinCheck {
  const below = new Map<string, FrameworkPin>();
  for (const deps of depMaps(projectPackageJson)) {
    for (const [name, spec] of Object.entries(deps)) {
      const minimum = judgeable(name, spec, minimums);
      if (minimum === null) continue;
      const order = compareVersions(spec as string, minimum);
      if (order !== null && order < 0 && !below.has(name)) {
        below.set(name, { name, pinned: spec as string, minimum });
      }
    }
  }
  return { status: below.size > 0 ? "update-required" : "ok", below: [...below.values()] };
}

/**
 * Rewrite the below-minimum exact pins in a package.json body up to the minimums.
 * Only deps already present change; nothing is added or removed and no other field is
 * touched. Returns null when there is nothing to rewrite (the recipe's idempotence).
 * Formatting is JSON parse/stringify with 2 spaces, as the IDE writes package.json
 * elsewhere (fullstack-files.ts).
 */
export function rewriteFrameworkPins(
  text: string,
  minimums: Record<string, string>,
): string | null {
  const pkg = parsePackageJson(text);
  if (pkg === null || typeof pkg !== "object") return null;
  const record = pkg as Record<string, unknown>;
  let changed = false;
  for (const field of DEP_FIELDS) {
    const deps = record[field];
    if (deps === null || typeof deps !== "object") continue;
    const map = deps as Record<string, unknown>;
    for (const [name, spec] of Object.entries(map)) {
      const minimum = judgeable(name, spec, minimums);
      if (minimum === null) continue;
      const order = compareVersions(spec as string, minimum);
      if (order !== null && order < 0) {
        map[name] = minimum;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(record, null, 2) + "\n" : null;
}

/**
 * The exact pin a new project writes for a framework package (D-198). A missing entry
 * is a build-data bug: the table covers every published package, and the example's
 * workspace:* spec must never leak into a generated project.
 */
export function publishedFrameworkPin(name: string, minimums: Record<string, string>): string {
  const version = minimums[name];
  if (version === undefined) throw new Error("no released version compiled in for " + name);
  return version;
}
