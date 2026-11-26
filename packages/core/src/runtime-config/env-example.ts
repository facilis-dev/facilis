import type { FacilisConfig } from "../config.ts";
import { ENV_PREFIX, PUBLIC_ENV_PREFIX, envNameFor } from "./resolve.ts";
import { isSecretMarker, type FacilisRuntimeDeclaration } from "./schema.ts";

/** First line of a generated file; the CLI refuses to overwrite anything else. */
export const ENV_EXAMPLE_HEADER =
  "# .env.example — generated from facilis.config.ts by `pnpm facilis:env --example` (D-224); do not edit by hand.";

const HEADER = [
  ENV_EXAMPLE_HEADER,
  "# Deployment values live in the `runtime` and `public` sections of facilis.config.ts (D-224).",
  "# Copy to `.env`, fill the required secrets and uncomment any literal you need to override.",
  "# No secret value is ever written here.",
].join("\n");

/**
 * The `.env.example` text for one project (D-224): the declarations, never the environment.
 *
 * A secret is a marker, not a value, so the generated line is always empty; the note says the
 * environment is the only source. Everything else is the declared literal, commented out so a
 * copied file never silently changes the deployment.
 */
export function renderEnvExample(config: FacilisConfig): string {
  const runtime = sortedEntries(config.runtime);
  const publicValues = sortedEntries(config.public);
  const lines = [
    HEADER,
    "",
    "# Runtime — server surface: FACILIS_<KEY> overrides the declared value at boot.",
  ];
  if (runtime.length === 0) lines.push("# (none declared)");
  for (const [key, value] of runtime) {
    const name = envNameFor(key, ENV_PREFIX);
    if (isSecretMarker(value)) {
      lines.push(`${name}=`);
      lines.push(
        "# required: a secret is read only from the environment; no value is written to git.",
      );
    } else {
      lines.push(`# ${name}=${renderValue(value)}`);
    }
  }
  lines.push(
    "",
    "# Public — client surface: FACILIS_PUBLIC_<KEY> is baked into the client bundle, build time only.",
  );
  if (publicValues.length === 0) lines.push("# (none declared)");
  for (const [key, value] of publicValues) {
    lines.push(`${envNameFor(key, PUBLIC_ENV_PREFIX)}=${renderValue(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function sortedEntries(
  declarations: Readonly<Record<string, FacilisRuntimeDeclaration>>,
): [string, FacilisRuntimeDeclaration][] {
  return Object.entries(declarations).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

/** A variable value: strings verbatim, JSON for arrays/objects, empty for an explicit null. */
function renderValue(value: FacilisRuntimeDeclaration): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
