import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDefaultLocale, setDefaultLocale, t } from "@facilis.dev/core/i18n";

import {
  hydrateCatalogs,
  normalizeLocale,
  resolveTranslation,
  resolveUserLocale,
} from "./client.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

beforeEach(() => {
  setDefaultLocale("en");
});

afterEach(() => {
  // The catalogue runtime is a module singleton shared with other tests.
  setDefaultLocale("en");
  vi.unstubAllGlobals();
});

describe("hydrateCatalogs", () => {
  it("fetches the requested locales and merges DB rows over the bundled JSON", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        en: { greeting: "Ciao", dbOnly: "db" },
        it: { greeting: "Salve" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await hydrateCatalogs({
      locales: ["en", "it"],
      base: {
        en: { greeting: "Hello", baseOnly: "base" },
        it: { greeting: "Buongiorno" },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock)).toBe("/api/i18n?locales=en%2Cit");

    // The DB row wins per key, keys it does not define fall back to the bundled JSON.
    expect(t("greeting")).toBe("Ciao");
    expect(t("baseOnly")).toBe("base");
    expect(t("dbOnly")).toBe("db");

    setDefaultLocale("it");
    expect(t("greeting")).toBe("Salve");
  });

  it("registers a locale from the base alone when the database has no rows for it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ en: { greeting: "Ciao" } })),
    );

    await hydrateCatalogs({
      locales: ["en", "it"],
      base: { it: { greeting: "Buongiorno" } },
    });

    setDefaultLocale("it");
    expect(t("greeting")).toBe("Buongiorno");
  });

  it("appends to an endpoint that already has a query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ en: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await hydrateCatalogs({ locales: ["en"], endpoint: "/custom?tenant=t1" });

    expect(urlOf(fetchMock)).toBe("/custom?tenant=t1&locales=en");
  });

  it("applies defaultLocale after registration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ en: { greeting: "Hello" } })),
    );

    await hydrateCatalogs({ locales: ["en"], defaultLocale: "it" });

    expect(getDefaultLocale()).toBe("it");
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );

    await expect(hydrateCatalogs({ locales: ["en"] })).rejects.toThrow(/HTTP 503/);
  });

  it("propagates network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(hydrateCatalogs({ locales: ["en"] })).rejects.toThrow("fetch failed");
  });

  it("throws when the response body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{", { status: 200 })),
    );

    await expect(hydrateCatalogs({ locales: ["en"] })).rejects.toThrow(/not valid JSON/);
  });

  const malformed: [string, unknown][] = [
    ["an array", []],
    ["null", null],
    ["a non-object locale catalogue", { en: "nope" }],
    ["a non-string message", { en: { greeting: 42 } }],
  ];

  it.each(malformed)("throws on a malformed payload (%s)", async (_label, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(payload)),
    );

    await expect(hydrateCatalogs({ locales: ["en"] })).rejects.toThrow(/^i18n:/);
  });
});

describe("browser boundary", () => {
  it("re-exports the pure locale/translation helpers", () => {
    expect(normalizeLocale("it-ch")).toBe("it-CH");
    expect(resolveTranslation({ en: "Todo", it: "Da fare" }, "it")).toBe("Da fare");
    expect(resolveUserLocale({ userLocale: "it" })).toBe("it");
  });

  it("imports only the browser-safe i18n subpath and the pure helpers", () => {
    const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
    expect(source).toContain('from "@facilis.dev/core/i18n"');
    expect(source).toContain('from "./translations.ts"');
    // The column helper and Drizzle must never enter a client bundle through this subpath.
    expect(source).not.toMatch(/@facilis.dev\/db|drizzle-orm|columns\.ts/);
  });
});
