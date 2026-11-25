// Frontend RUM build-time enablement (D-209, issue #138).
//
// apply: "build" only — `vite dev` never sees this plugin, so dev/WebContainer stays
// silent (D-200), the mirror of the dev-metrics companion's apply: "serve". The config is
// a define literal, not an inline HTML script (no CSP/rolldown risk) and not a virtual
// module: the disabled build compiles __FACILIS_RUM_CONFIG__ to null and bootRum() is a
// no-op. The boot call itself lives in the framework template entry.

import type { Plugin } from "vite";

import { readRumBuildConfig } from "./runtime/telemetry/rum-build-config.ts";

export const RUM_PLUGIN_NAME = "facilis:rum";
export const RUM_CONFIG_DEFINE = "__FACILIS_RUM_CONFIG__";

export function facilisRum(env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: RUM_PLUGIN_NAME,
    apply: "build",
    config(config) {
      // Never log the resolved config: it carries the tenant key.
      const rum = readRumBuildConfig(env);
      config.define = { ...config.define, [RUM_CONFIG_DEFINE]: JSON.stringify(rum) };
    },
  };
}
