#!/usr/bin/env node
// Static preview server for arm C (and any static output): directory-index
// resolution plus an SPA-shell fallback (shell.html) for non-allowlisted routes.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const rootDir = path.resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 4173);
const MIME = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const base = path.normalize(path.join(rootDir, clean));
  if (!base.startsWith(rootDir)) return null;
  for (const candidate of [base, base + ".html", path.join(base, "index.html")]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not present: try the next candidate shape.
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url ?? "/") ?? path.join(rootDir, "shell.html");
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log("serve-dist listening on http://127.0.0.1:" + port);
});
