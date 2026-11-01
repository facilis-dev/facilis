import { createServer } from "node:net";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/**
 * A real Postgres wire endpoint for driver "postgres" tests: PGlite behind the
 * pglite-socket TCP bridge. The bridge ignores the connecting user (every session is the
 * PGlite superuser "postgres"), so RLS tests must still go through SET LOCAL ROLE, which
 * is exactly what runWithPolicyScope does.
 *
 * PGlite is a single-connection engine and the bridge serialises queries across clients,
 * so a suite shares one server sequentially; it must not be reused across parallel files.
 */
export interface PostgresTestServer {
  /** libpq connection string for the bridge, e.g. `postgres://postgres@127.0.0.1:.../postgres`. */
  readonly url: string;
  stop(): Promise<void>;
}

/** Reserves a free loopback port: listen(0), read the OS-assigned port, release it. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("postgres test server: could not reserve a port")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

export async function startPostgresServer(): Promise<PostgresTestServer> {
  const port = await findFreePort();
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
    maxConnections: 10,
  });

  try {
    await server.start();
  } catch (error) {
    await db.close();
    throw error;
  }

  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
