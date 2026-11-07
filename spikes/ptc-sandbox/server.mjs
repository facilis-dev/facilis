// Static server with the IDE's cross-origin isolation headers (COOP/COEP), so the
// spike runs in the same document environment as the Studio.
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

export function startServer(port = 0) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/ping") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    if (url.pathname === "/runner.html") {
      // Production shape: the sandboxed runner is served with its own CSP header (all
      // browsers), instead of the Chrome-only csp="" attribute used by the srcdoc probe.
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; worker-src blob:",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "no-store",
      });
      response.end(
        '<!doctype html><script>' +
          'const post = (m) => parent.postMessage(m, "*");' +
          "const out = {};" +
          "try { localStorage.setItem(\"x\", \"1\"); out.localStorage = \"available\"; } catch { out.localStorage = \"blocked\"; }" +
          "fetch(location.origin + \"/ping\").then(() => out.fetch = \"allowed\", () => out.fetch = \"blocked\")" +
          ".then(() => post({ type: \"header-probe\", report: out }));" +
          "</script>",
      );
      return;
    }
    const file = path.join(ROOT, url.pathname === "/" ? "page.html" : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    });
    response.end(fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: "http://127.0.0.1:" + address.port + "/",
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
