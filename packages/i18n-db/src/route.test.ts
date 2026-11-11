import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineAuthorizedHandler, type FacilisRequestEvent } from "@facilis.dev/core";
import type { FacilisDb } from "@facilis.dev/db";

import { catalogQuery, loadCatalogs, parseCatalogLocales } from "./catalog.ts";
import { i18nMessages } from "./messages.ts";
import { createI18nTestDb } from "./test-support.ts";

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("explicit i18n route", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createI18nTestDb();
    await db.db.insert(i18nMessages).values([
      { tenantId: TENANT, locale: "en", key: "greeting", value: "Hello" },
      { tenantId: TENANT, locale: "en", key: "farewell", value: "Bye" },
      { tenantId: TENANT, locale: "it", key: "greeting", value: "Ciao" },
      { tenantId: OTHER_TENANT, locale: "en", key: "greeting", value: "Elsewhere" },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  // The contract's route shape, written literally: the project keeps
  // `export default defineAuthorizedHandler({ permission, dbTables, query }, ...)` so the
  // Nitro AST pass can read permission/dbTables (security invariant 2).
  const route = defineAuthorizedHandler(
    { permission: [], dbTables: ["i18n_messages"], query: catalogQuery },
    async (_event, { query, db: scopedDb }) =>
      loadCatalogs(scopedDb, parseCatalogLocales(query.locales)),
  );

  // A public GET event: no auth and no body reader, exactly what Nitro hands the route.
  function makeEvent(url: string): FacilisRequestEvent {
    return {
      context: { auth: null, facilis: { db, defaultTenantId: TENANT } },
      req: { headers: new Headers(), url, method: "GET" },
    };
  }

  it("returns the requested locales, scoped to the deployment tenant", async () => {
    await expect(route(makeEvent("http://localhost/api/i18n?locales=it,en"))).resolves.toEqual({
      it: { greeting: "Ciao" },
      en: { greeting: "Hello", farewell: "Bye" },
    });
  });

  it("defaults to the en catalogue when no locales are requested", async () => {
    await expect(route(makeEvent("http://localhost/api/i18n"))).resolves.toEqual({
      en: { greeting: "Hello", farewell: "Bye" },
    });
  });

  it("returns an empty catalogue for a locale without rows", async () => {
    await expect(route(makeEvent("http://localhost/api/i18n?locales=fr"))).resolves.toEqual({
      fr: {},
    });
  });

  it("collapses a blank locales value to the contract default", async () => {
    await expect(route(makeEvent("http://localhost/api/i18n?locales=%20%2C%20"))).resolves.toEqual({
      en: { greeting: "Hello", farewell: "Bye" },
    });
  });
});
