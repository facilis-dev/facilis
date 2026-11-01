// Postgres acceptance check (D-068): build the example app for production, run it
// against a real Postgres wire server, then drive the framework endpoints over HTTP.
//
// There is no Postgres server in the dev image, and a driver tested only against mocks
// proves nothing about pooling, SET LOCAL ROLE or RLS. So the "server" here is PGlite
// exposed over TCP by @electric-sql/pglite-socket: the real wire protocol, the real pg
// client on the other side. What this cannot cover (password auth, TLS, the network path)
// is the hosting provider's, and docs/POSTGRES.md §6 says so.
//
// Usage: pnpm pg:e2e            (builds @facilis/db and the example first)
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = path.join(REPO, "examples/todo-app");
const requireFromDb = createRequire(path.join(REPO, "packages/db/package.json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.once("listening", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.listen(0, "127.0.0.1");
  });
}

function build(target) {
  // The example bundles the workspace sources, but the provisioning step below imports
  // the packed-style dist of @facilis/db, so both builds are prerequisites.
  execFileSync("pnpm", ["--filter", target, "build"], { cwd: REPO, stdio: "inherit" });
}

async function main() {
  build("@facilis/db");
  build("@facilis/example-todo-app");

  const { PGlite } = requireFromDb("@electric-sql/pglite");
  const { PGLiteSocketServer } = requireFromDb("@electric-sql/pglite-socket");
  const db = await import("file://" + path.join(REPO, "packages/db/dist/index.js"));

  const pgPort = await freePort();
  const httpPort = await freePort();
  const url = "postgres://postgres@127.0.0.1:" + pgPort + "/postgres";
  const cluster = await PGlite.create();
  // The socket server defaults to ONE connection, and the provisioning client below keeps
  // its own open: without room for the app's pool every query is refused at connect time.
  const server = new PGLiteSocketServer({
    db: cluster,
    port: pgPort,
    host: "127.0.0.1",
    maxConnections: 10,
  });
  await server.start();
  console.log("postgres wire server: " + url);

  const admin = await db.createDb({ driver: "postgres", url });
  await db.applyMigrations(admin, { directory: path.join(EXAMPLE, "db/migrations") });
  await db.ensureAppRole(admin);

  const app = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: EXAMPLE,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: url,
      PORT: String(httpPort),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  app.stdout.on("data", (chunk) => (log += chunk));
  app.stderr.on("data", (chunk) => (log += chunk));

  const checks = [];
  const check = (ok, label, detail = "") => {
    checks.push(ok);
    console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
  };
  const base = "http://127.0.0.1:" + httpPort;
  const call = (pathname, init) => fetch(base + pathname, init);
  const json = (body) => ({ "content-type": "application/json", body: JSON.stringify(body) });

  try {
    const up = await waitForServer(call);
    if (!up) {
      console.error("the built server never answered. log:\n" + log.slice(-4000));
      process.exitCode = 1;
      return;
    }

    // A production boot must not run migrations or the dev bootstrap: the schema and the
    // app role are provisioned above, exactly like a deploy step.
    check((await call("/api/todos")).status === 401, "anonymous request is 401");

    const registered = await call("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...json({ email: "e2e@example.test", password: "correct horse battery" }),
    });
    check(registered.ok, "register", String(registered.status));

    // Registration does not start a session; login does, and sets the cookie (D-038).
    const logged = await call("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...json({ email: "e2e@example.test", password: "correct horse battery" }),
    });
    const cookie = (logged.headers.get("set-cookie") ?? "").split(";")[0];
    check(logged.ok && cookie.startsWith("facilis_session="), "login sets the session cookie");

    const created = await call("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      ...json({ title: "written to real postgres" }),
    });
    check(created.ok, "create a todo", String(created.status));

    const listed = await call("/api/todos", { headers: { cookie } });
    const todos = await listed.json();
    check(JSON.stringify(todos).includes("written to real postgres"), "the todo is listed back");

    // The session lookup runs inside a tenant-scoped transaction, so it needs no
    // privileged connection: this is the least-privilege runtime path (D-068 §3).
    const session = await call("/api/auth/session", { headers: { cookie } });
    const authenticated = await session.json();
    check(
      session.ok && authenticated.authenticated === true && authenticated.roles?.includes("user"),
      "the session is authenticated with the default role",
    );

    // The row must be in the Postgres cluster, not in some in-memory fallback.
    const rows = await admin.db.execute("select title from todos");
    check(
      rows.rows.length === 1 && rows.rows[0].title === "written to real postgres",
      "the row is in the Postgres cluster",
      JSON.stringify(rows.rows),
    );
  } finally {
    app.kill("SIGTERM");
    await sleep(500);
    await admin.close();
    await server.stop();
    await cluster.close();
  }

  const failed = checks.filter((ok) => !ok).length;
  if (failed > 0) console.error("server log:\n" + log.slice(-6000));
  console.log(failed === 0 ? "E2E OK" : "E2E FAILED: " + failed);
  process.exitCode = failed === 0 ? 0 : 1;
}

async function waitForServer(call, limitMs = 60000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      await call("/api/auth/session");
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

await main();
