// Vite dev-server bridge for the git smart-HTTP proxy (D-079).
//
// pnpm ide:dev must expose the same /git-proxy route as the deployed Pages Function,
// otherwise the browser git client cannot reach a host during development. The handler
// is shared; only the Node IncomingMessage <-> Fetch API adaptation lives here.

import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { createGitProxy, parseAllowedHosts } from "./git-proxy/handler.mjs";

const MOUNT = "/git-proxy";

/** The handler parses a full URL, so rebuild the one connect stripped on mount. */
function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(`http://${host}${MOUNT}${req.url ?? "/"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }

  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as RequestInit["body"];
    init.duplex = "half";
  }
  return new Request(url, init);
}

function writeWebResponse(res: ServerResponse, response: Response): void {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (response.body === null) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(response.body);
  body.on("error", () => res.destroy());
  body.pipe(res);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  proxy: { fetch: (request: Request) => Promise<Response> },
): Promise<void> {
  try {
    writeWebResponse(res, await proxy.fetch(toWebRequest(req)));
  } catch {
    // Never log here: the proxy's contract is a silent, stateless pass-through. A failure
    // before headers are sent is still a proxy-level upstream failure from the client's
    // point of view.
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
      res.end("git proxy: upstream request failed");
    } else {
      res.destroy();
    }
  }
}

export function gitProxyDevPlugin(): Plugin {
  return {
    name: "facilis-git-proxy",
    configureServer(server) {
      // Same env var as the Pages deployment. Read once, at server start: the allowlist
      // is configuration, not per-request state.
      const allow = parseAllowedHosts(process.env.GIT_PROXY_ALLOW);
      const proxy = createGitProxy({ allow });
      server.middlewares.use(MOUNT, (req, res) => {
        void handle(req, res, proxy);
      });
    },
  };
}
