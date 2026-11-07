// Dev/preview headers for the PTC sandbox runner (D-101, docs/PTC.md §5).
//
// The runner page must be reachable at /ptc-runner.html but must NOT inherit the app's
// CSP: it needs its own restrictive policy (default-src 'none') so a program has no
// egress, plus COOP/COEP so it matches the Studio's isolated document. Production hosts
// must reproduce these headers per path; this plugin covers dev and preview.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

export const PTC_RUNNER_PATH = "/ptc-runner.html";
export const PTC_RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline'; worker-src blob:";

/** COOP/COEP keep the runner in the same isolated world as the Studio; no-store keeps a
 * stale runner from surviving a rebuild. */
const HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": PTC_RUNNER_CSP,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function runnerHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  next: Connect.NextFunction,
): void {
  const path = (request.url ?? "").split("?")[0]?.split("#")[0];
  if (path !== PTC_RUNNER_PATH) {
    next();
    return;
  }
  for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
  next();
}

export function ptcRunnerHeaders(): Plugin {
  const attach = (server: { middlewares: Connect.Server }): void => {
    server.middlewares.use(runnerHeaders);
  };
  return {
    name: "facilis-ptc-runner-headers",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
