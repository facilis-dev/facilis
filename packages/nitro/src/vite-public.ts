import type { FacilisConfig } from "@facilis.dev/core/config";
import { resolvePublicConfig, type EnvLike } from "@facilis.dev/core/runtime-config";

/** The define the `public` section is baked into (D-224); `publicConfig()` reads it. */
export const PUBLIC_CONFIG_DEFINE = "__FACILIS_PUBLIC_CONFIG__";

/**
 * The `define` entries that carry the `public` section into the client bundle (D-224).
 *
 * Resolution happens here, once per build: the file's values, overridden by
 * `FACILIS_PUBLIC_<KEY>` in the environment of the build. Anything the section does not declare
 * fails the build by name — a typo in a deployment variable must not become a silent default.
 */
export function publicConfigDefine(
  config: FacilisConfig | null,
  env: EnvLike = process.env,
): Record<string, string> {
  const resolved = resolvePublicConfig({ public: config?.public, env });
  if (resolved.problems.length > 0) {
    throw new Error(
      "[facilis] public config:\n" +
        resolved.problems.map((entry) => `  ${entry.envName}  ${entry.message}`).join("\n"),
    );
  }
  return { [PUBLIC_CONFIG_DEFINE]: JSON.stringify(resolved.public) };
}
