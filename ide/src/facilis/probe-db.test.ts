// The probe's database roundtrip is string templates: nothing typechecks the generated
// routes, so a lost `todos:write` role or a renamed data-* attribute would only surface as
// a red smoke run inside the WebContainer. These assertions keep the contract wired: the app
// publishes facilisDbInsert/facilisDbQuery, and the API it calls exists with the required
// permission, dbTables and auth-derived tenant/owner columns.

import { describe, expect, it } from "vitest";
import { clientFiles } from "./client-files";
import { dbFiles } from "./db-files";
import { projectFiles } from "./project-files";
import { serverAuthFiles } from "./server-auth-files";
import { serverFiles } from "./server-files";

const app = clientFiles["src/App.tsx"];
const config = projectFiles()["facilis.config.ts"];

describe("Facilis probe database roundtrip", () => {
  it("publishes the session, insert and query results for the smoke", () => {
    expect(app).toContain('root.dataset["facilisAuth"]');
    expect(app).toContain('root.dataset["facilisDbInsert"]');
    expect(app).toContain('root.dataset["facilisDbQuery"]');
  });

  it("registers, logs in and inserts through the real routes", () => {
    expect(app).toContain('postJson("/api/auth/register"');
    expect(app).toContain('postJson("/api/auth/login"');
    expect(app).toContain('postJson("/api/todos"');
    expect(app).toContain("containsTitle(");
  });

  it("ships the auth routes the probe calls", () => {
    expect(Object.keys(serverAuthFiles).sort()).toEqual([
      "server/routes/api/auth/login.post.ts",
      "server/routes/api/auth/register.post.ts",
      "server/routes/api/auth/session.get.ts",
      "server/utils/http.ts",
      "server/utils/tenant.ts",
    ]);
    expect(serverAuthFiles["server/routes/api/auth/login.post.ts"]).toContain("createSession(");
    // D-038: the cookie must be staged on the event's response headers; a Set-Cookie on a
    // returned Response is lost in the in-VM Nitro dev path and logs the user out next request.
    expect(serverAuthFiles["server/routes/api/auth/login.post.ts"]).toContain(
      'event.res?.headers.set("set-cookie"',
    );
    expect(serverAuthFiles["server/routes/api/auth/register.post.ts"]).toContain("hashPassword(");
  });

  it("inserts through an authorized handler scoped by auth", () => {
    const route = serverFiles["server/routes/api/todos/index.post.ts"];
    expect(route).toContain('permission: ["todos:write"]');
    expect(route).toContain('dbTables: ["todos"]');
    expect(route).toContain("tenantId: auth.tenantId");
    expect(route).toContain("ownerId: auth.userId");
  });

  it("gives the registration default role the write permission and seeds it", () => {
    expect(config).toMatch(/user: \["todos:read", "todos:write"\]/);
    expect(dbFiles["db/migrations/0001_seed_roles.sql"]).toContain("('user', 'todos:write')");
  });
});
