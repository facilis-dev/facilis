#!/usr/bin/env node
// Standalone git smart-HTTP proxy for self-hosted deployments (D-079).
//
// Same handler as the Cloudflare Pages Function, wrapped in a plain http.Server so an
// operator who does not use Pages can still serve the IDE behind this proxy. It keeps
// the proxy contract: one startup line, no per-request output, no storage.

import http from "node:http";
import { Readable } from "node:stream";
import { createGitProxy, parseAllowedHosts } from "../../ide/git-proxy/handler.mjs";

const DEFAULT_PORT = 8787;

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let allow;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port" || arg.startsWith("--port=")) {
      const raw = arg === "--port" ? argv[index + 1] : arg.slice("--port=".length);
      if (arg === "--port") index += 1;
      port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--port must be an integer between 1 and 65535");
      }
    } else if (arg === "--allow" || arg.startsWith("--allow=")) {
      allow = arg === "--allow" ? argv[index + 1] : arg.slice("--allow=".length);
      if (arg === "--allow") index += 1;
      if (allow === undefined) throw new Error("--allow needs a comma-separated host list");
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { port, allow };
}

/** Build the browser-equivalent request from the Node request. */
function toWebRequest(req, port) {
  const host = req.headers.host ?? `127.0.0.1:${port}`;
  const url = new URL(`http://${host}${req.url ?? "/"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }

  const method = req.method ?? "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    // Stream, never buffer: git packs are tens of megabytes.
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

function writeWebResponse(res, response) {
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

async function handle(req, res, proxy, port) {
  let request;
  try {
    request = toWebRequest(req, port);
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "text/plain");
    res.end("bad request");
    return;
  }
  try {
    writeWebResponse(res, await proxy.fetch(request));
  } catch {
    // Silent like the handler: no upstream detail, no console output.
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
      res.end("git proxy: upstream request failed");
    } else {
      res.destroy();
    }
  }
}

const { port, allow } = parseArgs(process.argv.slice(2));
const allowedHosts = parseAllowedHosts(allow);
const proxy = createGitProxy({ allow: allowedHosts });
const server = http.createServer((req, res) => {
  void handle(req, res, proxy, port);
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `git proxy listening on http://127.0.0.1:${port} (allow: ${allowedHosts.join(", ")})`,
  );
});
