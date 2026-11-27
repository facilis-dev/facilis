/**
 * The framework's runtime requirements, checked against the project's declarations (D-224).
 *
 * The message prints the exact declaration line to paste, taken from the canonical tooling
 * values: the framework never merges a default, it only tells the app what to write.
 */
import {
  runtimeDeclarationLine,
  runtimeRequirements,
  type RuntimeRequirement,
} from "@facilis.dev/core/runtime-config";

import { error } from "../diagnostics.ts";
import type { ConfigFacts, Diagnostic } from "../types.ts";

export const RUNTIME_KEY_MISSING = "runtime-key-missing";

export function requirementDiagnostics(config: ConfigFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const requirement of runtimeRequirements) {
    const section =
      requirement.surface === "server" ? config.runtimeConfig.runtime : config.runtimeConfig.public;
    const unknown =
      requirement.surface === "server"
        ? config.runtimeConfig.runtimeUnknown
        : config.runtimeConfig.publicUnknown;
    // A spread or computed section can hide the key: unknown is never reported as missing.
    if (unknown || !conditionHolds(requirement, config)) continue;
    if (section[requirement.key] !== undefined) continue;
    diagnostics.push(error(RUNTIME_KEY_MISSING, missingMessage(requirement), config.source));
  }
  return diagnostics;
}

function conditionHolds(requirement: RuntimeRequirement, config: ConfigFacts): boolean {
  const when = requirement.when;
  if (when === undefined) return true;
  const fact = config.runtimeConfig.runtime[when.key];
  if (fact === undefined || fact.state !== "literal") return false;
  return JSON.stringify(fact.value) === JSON.stringify(when.equals);
}

function missingMessage(requirement: RuntimeRequirement): string {
  const section = requirement.surface === "server" ? "runtime" : "public";
  const when =
    requirement.when === undefined
      ? ""
      : " (required when " +
        requirement.when.key +
        " is " +
        formatValue(requirement.when.equals) +
        ")";
  return (
    "facilis.config.ts must declare " +
    section +
    "." +
    requirement.key +
    when +
    "; add: " +
    runtimeDeclarationLine(requirement.key)
  );
}

function formatValue(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}
