/**
 * Build-time public data for the prerender pass (D-202 §1/§7): loopback HTTP against the
 * project's BUILT Nitro server, with no session and no system identity. A 401/403/error
 * response fails the build — an error body is never written as a page.
 *
 * The built node-server entry auto-listens on import; srvx's `__srvxLoader__` hook takes
 * over server creation so the pass owns the listener (ephemeral loopback port) and can close
 * it deterministically — an open listener would hang `vite build` after closeBundle.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

import { routeFactId, type Analysis, type PrerenderEligibilityFact } from "@facilis.dev/analyze";

/** The public GET paths one eligible page calls (its island subset). */
export function pagePublicGets(analysis: Analysis, fact: PrerenderEligibilityFact): string[] {
  if (fact.pageFile === null) return [];
  const page = analysis.pages.find((candidate) => candidate.path === fact.pageFile);
  if (page === undefined) return [];
  const paths: string[] = [];
  for (const call of page.calls) {
    for (const id of call.matchedRouteIds) {
      const route = analysis.routes.find((candidate) => routeFactId(candidate) === id);
      // Eligibility already proved every call public; only GETs are prefetchable data.
      if (route === undefined || route.method !== "GET") continue;
      if (route.permission === null || route.permission.length > 0) continue;
      if (!paths.includes(route.path)) paths.push(route.path);
    }
  }
  return paths;
}

interface SrvxServerLike {
  readonly node: { readonly handler: (req: IncomingMessage, res: ServerResponse) => void };
  /** Wrapped by nitro's setupCloseHooks: runs the app "close" hooks (PGlite shutdown). */
  readonly close: (closeAll?: boolean) => Promise<unknown>;
}

type SrvxLoader = (info: { server: SrvxServerLike }) => void;

/**
 * Fetch every path over loopback HTTP with no cookies/identity and return the responses
 * keyed by request path. Any non-2xx (including a redirect to a login) throws: fail closed.
 */
export async function fetchPublicData(
  serverEntryPath: string,
  paths: readonly string[],
): Promise<Record<string, unknown>> {
  if (paths.length === 0) return {};
  const globals = globalThis as { __srvxLoader__?: SrvxLoader };
  const previousLoader = globals.__srvxLoader__;
  // The pass is a build-time activity, not a deployment: boot the project's dev runtime
  // (D-068 refuses in-memory PGlite under NODE_ENV=production; a Postgres URL still wins).
  const previousNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "development";
  let captured: SrvxServerLike | undefined;
  globals.__srvxLoader__ = ({ server }) => {
    captured = server;
  };
  try {
    await import(pathToFileURL(serverEntryPath).href);
  } finally {
    if (previousLoader === undefined) delete globals.__srvxLoader__;
    else globals.__srvxLoader__ = previousLoader;
  }
  if (captured === undefined) {
    throw new Error(
      "[facilis] prerender-data: the built server exposed no handler (srvx loader hook absent)",
    );
  }
  const server = createServer(captured.node.handler);
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) {
    server.close();
    throw new Error("[facilis] prerender-data: the loopback data server did not listen");
  }
  try {
    const data: Record<string, unknown> = {};
    for (const path of paths) {
      // No credentials, no forwarded identity; manual redirects so a login bounce fails.
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers: { accept: "application/json" },
        redirect: "manual",
      });
      if (!response.ok) {
        throw new Error(
          `[facilis] prerender-data: GET ${path} returned ${response.status} — an error body is never prerendered`,
        );
      }
      data[path] = (await response.json()) as unknown;
    }
    return data;
  } finally {
    server.close();
    // The listener is ours, but the app's close hooks (db shutdown) hang off the captured
    // server; without them PGlite keeps the build process alive after closeBundle.
    await captured.close();
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = previousNodeEnv;
  }
}
