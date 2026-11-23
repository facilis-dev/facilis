// Postgres acceptance check (D-068): build the example app for production, run it
// against a real Postgres wire server, then drive the framework endpoints over HTTP.
//
// There is no Postgres server in the dev image, and a driver tested only against mocks
// proves nothing about pooling, SET LOCAL ROLE or RLS. So the "server" here is PGlite
// exposed over TCP by @electric-sql/pglite-socket: the real wire protocol, the real pg
// client on the other side. What this cannot cover (password auth, TLS, the network path)
// is the hosting provider's, and docs/POSTGRES.md §6 says so.
//
// Lifecycle (issue #153): one run per host (e2e-lock), every phase on a budget, every child
// in its own process group, and the server behind a watchdog that reaps the group when this
// process dies — including SIGKILL, where no handler and no `finally` can run. The coverage
// below is unchanged: same endpoints, same assertions, same real wire protocol.
//
// Usage: pnpm pg:e2e            (builds @facilis.dev/db and the example first)
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireLock, lockPath, lockWaitMs } from "./e2e-lock.mjs";
import {
  createCleanup,
  installExitHandlers,
  killGroupIfRunning,
  runCommand,
  spawnGroup,
  stopGroup,
  withTimeout,
} from "./e2e-process.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = path.join(REPO, "examples/todo-app");
const WATCHDOG = path.join(REPO, "scripts", "e2e-watchdog.mjs");
const requireFromDb = createRequire(path.join(REPO, "packages/db/package.json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Phase budgets stay well above the longest legitimate phase so a slow shared machine is not
 * mistaken for a hang; a timeout is a diagnostic, never a silent pass. Each is overridable.
 */
function budgetMs(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
const LIMITS = {
  build: budgetMs("FACILIS_PG_E2E_BUILD_TIMEOUT_MS", 600_000),
  provision: budgetMs("FACILIS_PG_E2E_PROVISION_TIMEOUT_MS", 180_000),
  boot: budgetMs("FACILIS_PG_E2E_BOOT_TIMEOUT_MS", 90_000),
  request: budgetMs("FACILIS_PG_E2E_REQUEST_TIMEOUT_MS", 30_000),
  teardown: budgetMs("FACILIS_PG_E2E_TEARDOWN_TIMEOUT_MS", 20_000),
  run: budgetMs("FACILIS_PG_E2E_TIMEOUT_MS", 1_500_000),
};

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

async function build(target, cleanup) {
  // The example bundles the workspace sources, but the provisioning step below imports
  // the packed-style dist of @facilis.dev/db, so both builds are prerequisites.
  const exit = await runCommand("pnpm", ["--filter", target, "build"], {
    cwd: REPO,
    timeoutMs: LIMITS.build,
    label: "build " + target,
    cleanup,
  });
  if (exit.code !== 0) {
    throw new Error(`build ${target} failed (code=${exit.code} signal=${exit.signal})`);
  }
}

/** Boot PGlite and the wire server, then provision the declared schema exactly like a deploy. */
async function provision(url, pgPort, cleanup) {
  const { PGlite } = requireFromDb("@electric-sql/pglite");
  const { PGLiteSocketServer } = requireFromDb("@electric-sql/pglite-socket");
  const db = await import("file://" + path.join(REPO, "packages/db/dist/index.js"));
  const core = await import("file://" + path.join(REPO, "packages/core/dist/index.js"));
  const auth = await import("file://" + path.join(REPO, "packages/auth/dist/index.js"));

  const cluster = await PGlite.create();
  cleanup.add(() => cluster.close());
  // The socket server defaults to ONE connection, and the provisioning client below keeps
  // its own open: without room for the app's pool every query is refused at connect time.
  const server = new PGLiteSocketServer({
    db: cluster,
    port: pgPort,
    host: "127.0.0.1",
    maxConnections: 10,
  });
  await server.start();
  cleanup.add(() => server.stop());

  // D-193: a generated project ships no DDL. Provision the example's declared schema through
  // the release planner, the same batches a deploy applies, instead of committed SQL.
  const declaredSchema = await import("file://" + path.join(EXAMPLE, "db/schema.ts"));
  const admin = await db.createDb({ driver: "postgres", url, schema: declaredSchema });
  cleanup.add(() => admin.close());
  const declared = await db.schemaSnapshot(admin);
  const plan = core.planSchema({ tables: [], enums: [] }, declared);
  if (plan.problems.length > 0) {
    throw new Error("declared schema has planner problems: " + JSON.stringify(plan.problems));
  }
  await db.applyStatements(admin, plan.batches.map((batch) => batch.sql));
  // The deploy step owns the seed and the roles too: the retired migrations used to insert
  // the configured roles and create the two database roles, and a production boot never
  // does (a restricted runtime role can neither seed nor CREATE ROLE).
  const projectConfig = await import("file://" + path.join(EXAMPLE, "facilis.config.ts"));
  await db.applyStatements(admin, auth.seedStatements(projectConfig.default.auth));
  await db.ensureAppRole(admin);
  await db.ensureSystemRole(admin);
  return { admin };
}

async function main() {
  const cleanup = createCleanup();
  const handlers = installExitHandlers(cleanup);
  const deadline = setTimeout(
    () => handlers.trigger(`run deadline of ${LIMITS.run} ms exceeded`, 1),
    LIMITS.run,
  );
  let log = "";
  try {
    const lock = await acquireLock({ file: lockPath(), waitMs: lockWaitMs() });
    cleanup.addSync(() => lock.release());
    console.log(`pg:e2e host lock: ${lock.file} (pid ${lock.holder.pid})`);

    await build("@facilis.dev/db", cleanup);
    await build("@facilis.dev/core", cleanup);
    await build("@facilis.dev/auth", cleanup);
    await build("@facilis.dev/example-todo-app", cleanup);

    const pgPort = await freePort();
    const httpPort = await freePort();
    const url = "postgres://postgres@127.0.0.1:" + pgPort + "/postgres";
    const { admin } = await withTimeout(
      provision(url, pgPort, cleanup),
      LIMITS.provision,
      "provision",
    );
    console.log("postgres wire server: " + url);

    // The watchdog leads a new process group and holds the server inside it; stdin is the
    // liveness pipe this harness never writes to, so EOF tells it the harness died.
    const app = spawnGroup(
      process.execPath,
      [WATCHDOG, process.execPath, ".output/server/index.mjs"],
      {
        cwd: EXAMPLE,
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: url,
          PORT: String(httpPort),
          HOST: "127.0.0.1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    cleanup.addSync(() => killGroupIfRunning(app));
    cleanup.add(() => stopGroup(app, LIMITS.teardown));
    app.stdout.on("data", (chunk) => (log += chunk));
    app.stderr.on("data", (chunk) => (log += chunk));

    const checks = [];
    const check = (ok, label, detail = "") => {
      checks.push(ok);
      console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
    };
    const base = "http://127.0.0.1:" + httpPort;
    const call = (pathname, init) =>
      fetch(base + pathname, { ...init, signal: AbortSignal.timeout(LIMITS.request) });
    const json = (body) => ({ "content-type": "application/json", body: JSON.stringify(body) });

    const up = await waitForServer(call);
    if (!up) {
      console.error(
        `the built server never answered within ${LIMITS.boot} ms. log:\n` + log.slice(-4000),
      );
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

    const failed = checks.filter((ok) => !ok).length;
    if (failed > 0) console.error("server log:\n" + log.slice(-6000));
    console.log(failed === 0 ? "E2E OK" : "E2E FAILED: " + failed);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    clearTimeout(deadline);
    const errors = await cleanup.run();
    for (const error of errors) console.error("cleanup error: " + (error?.message ?? error));
    handlers.uninstall();
  }
}

async function waitForServer(call, limitMs = LIMITS.boot) {
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

await main().catch((error) => {
  console.error("pg:e2e failed: " + (error?.stack ?? error));
  process.exitCode = 1;
});
