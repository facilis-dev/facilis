// The dev-only runtime metrics injection (D-200, issue #71).
//
// A companion to the framework plugin in vite.ts: apply "serve" means Vite drops it from
// `vite build` entirely, so a production artifact contains no metrics client and there is
// no endpoint to answer (option 1 adds none — security invariant 6 is untouched). The
// injected client stays dormant until the IDE's runtime lens enables it; disabling the
// feature is FACILIS_DEV_METRICS=0, which removes the injection without touching project
// code.

import type { Plugin } from "vite";

import { DEV_METRICS_CLIENT_SOURCE } from "./dev-metrics-client.ts";

export const DEV_METRICS_PLUGIN_NAME = "facilis:dev-metrics";

/** Rollback switch (D-200): FACILIS_DEV_METRICS=0 removes the injected module. */
export function devMetricsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FACILIS_DEV_METRICS !== "0";
}

/**
 * Inject the metrics client as the first script of every dev-served HTML document.
 * head-prepend runs it before the app's module scripts, so an enable message that
 * arrives during boot still wraps fetch before the app's first request.
 */
export function facilisDevMetrics(env: NodeJS.ProcessEnv = process.env): Plugin {
  const enabled = devMetricsEnabled(env);
  return {
    name: DEV_METRICS_PLUGIN_NAME,
    apply: "serve",
    transformIndexHtml(html) {
      if (!enabled) return html;
      return {
        html,
        tags: [
          {
            tag: "script",
            children: DEV_METRICS_CLIENT_SOURCE,
            injectTo: "head-prepend",
          },
        ],
      };
    },
  };
}
