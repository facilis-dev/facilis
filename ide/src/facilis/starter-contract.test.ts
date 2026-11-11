// The generated project is examples/todo-app (D-062): nothing typechecks the inlined
// sources at IDE build time, so a lost `todos:write` role, a renamed column or a drifted
// route would only surface as a red smoke run inside the WebContainer. These assertions
// keep the starter's API/schema/auth contract wired; the endpoint behaviour itself is the
// smoke's job (scripts/dev/smoke-facilis.mjs drives it from the IDE page).

import { describe, expect, it } from "vitest";
import { createFacilisTemplate } from "./facilis-template";

const files = createFacilisTemplate().files;
const config = files["facilis.config.ts"];
const authRoutes = Object.keys(files)
  .filter((path) => path.startsWith("server/routes/api/auth/"))
  .sort();

describe("generated starter contract", () => {
  it("ships the example's auth routes", () => {
    expect(authRoutes).toEqual([
      "server/routes/api/auth/clients/[id].delete.ts",
      "server/routes/api/auth/clients/index.get.ts",
      "server/routes/api/auth/clients/index.post.ts",
      "server/routes/api/auth/login.post.ts",
      "server/routes/api/auth/logout.post.ts",
      "server/routes/api/auth/register.post.ts",
      "server/routes/api/auth/session.get.ts",
      "server/routes/api/auth/verify-email.get.ts",
    ]);
    const login = files["server/routes/api/auth/login.post.ts"];
    expect(login).toContain("createSession(");
    // D-038: the cookie goes through the framework helper, which calls h3's setCookie and so
    // stages it on the event's response headers. A Set-Cookie on a returned Response is lost
    // in the in-VM Nitro dev path and logs the user out on the next request.
    expect(login).toContain('import { setSessionCookie } from "@facilis/nitro/session"');
    expect(login).toContain("setSessionCookie(event, session.id");
    expect(login).not.toContain('headers.set("set-cookie"');
    const register = files["server/routes/api/auth/register.post.ts"];
    expect(register).toContain("hashPassword(");
    // D-099: an anonymous caller has no permission on the auth tables; the writes are an
    // audited system operation, never direct DB access from the handler.
    expect(register).toContain("system(");
    expect(register).toContain('actor: "system:auth"');
    expect(register).toContain('operation: "user:register"');
    expect(register).not.toContain("facilis.db");
    // D-156: registration issues the single-use link through the framework primitive and the
    // verify route consumes it; both replace a direct write to the verification table.
    expect(register).toContain("issueEmailVerification(");
    expect(register).toContain("EMAIL_VERIFICATION_TABLES");
    const verify = files["server/routes/api/auth/verify-email.get.ts"];
    expect(verify).toContain("consumeEmailVerification(");
    expect(verify).toContain("permission: []");
  });

  it("inserts through an authorized handler without naming the tenant", () => {
    const route = files["server/routes/api/todos/index.post.ts"];
    expect(route).toContain('permission: ["todos:write"]');
    expect(route).toContain('dbTables: ["todos"]');
    // D-040: the tenant column defaults from app.tenant_id; only the owner is explicit.
    expect(route).not.toContain("tenantId:");
    expect(route).toContain("ownerId: auth.userId");
  });

  it("declares the tenant column default and ships its migration", () => {
    expect(files["db/schema.ts"]).toContain("tenantId: tenantColumn()");
    expect(files["db/migrations/0001_tenant_default.sql"]).toContain("SET DEFAULT nullif(");
  });

  it("wires binary storage into the config, package and schema", () => {
    // D-053/D-116: the framework ships the runtime (config section + helpers); the template
    // proves it end to end with a metadata table, its link table and the three routes below.
    expect(config).toMatch(/storage:\s*\{/);
    expect(config).toContain('driver: "local"');
    const pkg = JSON.parse(files["package.json"]) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@facilis/storage"]).toBe("file:./vendor/facilis-storage-0.0.0.tgz");
    expect(files["db/schema.ts"]).toContain("fileLinks(todos");
    const migration = Object.keys(files).find((path) => path.startsWith("db/migrations/0003_"));
    expect(migration, "missing the file-link migration").toBeDefined();
    const sql = files[migration ?? ""];
    expect(sql).toContain("facilis_files");
    expect(sql).toContain("todo_files");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("uploads through the framework helper and reads blobs token-only", () => {
    const upload = files["server/routes/api/todos/[id]/files/index.post.ts"];
    expect(upload).toContain("defineAuthorizedHandler");
    expect(upload).toContain("storeUpload(");
    // The download is public by design: the short-lived token is the credential, so the
    // handler declares no permission and the route stays usable as an <img src>.
    const download = files["server/routes/api/files/[id].get.ts"];
    expect(download).toContain("defineAuthorizedHandler");
    expect(download).toContain("permission: []");
    expect(download).toContain("sendStoredFile(");
  });

  it("gives the registration default role the write permission and seeds it", () => {
    // The queue is RLS-gated by permissions (D-145), so the starter's default role carries
    // them too: the template config and the seed migration must stay in lockstep.
    expect(config).toMatch(/user: \["todos:read", "todos:write", "jobs:read", "jobs:exec"\]/);
    expect(files["db/migrations/0001_seed_roles.sql"]).toContain("('user', 'todos:write')");
    expect(files["db/migrations/0001_seed_roles.sql"]).toContain("('user', 'jobs:read')");
  });

  it("keeps the starter free of test instrumentation", () => {
    // The probe lives in the smoke (D-062), not in the user's project.
    expect(files["src/app.tsx"]).not.toContain("runProbe");
    expect(files).not.toHaveProperty("src/lib/probe.ts");
  });
});
