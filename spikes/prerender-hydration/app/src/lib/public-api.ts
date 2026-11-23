// The public API surface (a permission: []-style endpoint): no session, no auth
// check, no system identity — the only kind of API a prerendered page may call.
import http from "node:http";

export interface StatsPayload {
  total: number;
  items: { name: string; value: number }[];
}

// Deterministic data: no Date.now()/random, so server and client markup match.
export function publicStats(): StatsPayload {
  return {
    total: 3,
    items: [
      { name: "alpha", value: 10 },
      { name: "beta", value: 20 },
      { name: "gamma", value: 30 },
    ],
  };
}

// Build-time host for arms B/C: the prerender pass fetches the public endpoint
// over real localhost HTTP (in-VM fetch is one of the unknowns under test).
export function createPublicServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.url === "/api/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(publicStats()));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });
}

export function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}
