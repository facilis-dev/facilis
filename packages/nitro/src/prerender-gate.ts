/**
 * The full-stack prerender build gate (D-202 §3): a declared-but-ineligible route fails
 * `vite build` with a framework code naming route + reason — never a silent skip.
 *
 * A companion to the framework plugin in vite.ts: apply "build" keeps it out of dev, where
 * the analyzer's diagnostics stay warnings. It reads the same cached analysis the framework
 * plugin owns, so the gate adds no second analyzer run.
 */

import type { Plugin } from "vite";

import {
  formatPrerenderReasons,
  prerenderBuildErrors,
  type Analysis,
  type PrerenderBuildError,
} from "@facilis.dev/analyze";

export const PRERENDER_GATE_PLUGIN_NAME = "facilis:prerender-gate";

/** Machine code + route + reasons, the one message format both build gates share. */
export function formatPrerenderBuildError(failure: PrerenderBuildError): string {
  return (
    `[facilis] ${failure.code}: route "${failure.route}" is not prerender-eligible ` +
    formatPrerenderReasons(failure.reasons)
  );
}

/** Fail the build on every declared-and-ineligible route; silent when prerendering is off. */
export function facilisPrerenderGate(getAnalysis: () => Analysis | undefined): Plugin {
  return {
    name: PRERENDER_GATE_PLUGIN_NAME,
    apply: "build",
    buildStart() {
      const analysis = getAnalysis();
      if (analysis === undefined) return;
      for (const failure of prerenderBuildErrors(analysis.prerender)) {
        this.error(formatPrerenderBuildError(failure));
      }
    },
  };
}
