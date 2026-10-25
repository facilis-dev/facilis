import { describe, expect, it } from "vitest";
import { defineConfig } from "@facilis/core";

import {
  ALL_MANIFEST_SECTIONS,
  parseSectionsParameter,
  selectManifestSections,
} from "./manifest-sections.ts";
import { buildManifestData } from "./manifest-data.ts";

const config = defineConfig({
  auth: { permissions: ["todos:read"], roles: { user: ["todos:read"] }, defaultRole: "user" },
});

describe("parseSectionsParameter", () => {
  it("defaults to all sections", () => {
    expect(parseSectionsParameter(null)).toEqual({ ok: true, invalid: [] });
    expect(parseSectionsParameter("  ")).toEqual({ ok: true, invalid: [] });
  });

  it("parses and deduplicates section names", () => {
    expect(parseSectionsParameter("config,routes,config")).toEqual({
      ok: true,
      sections: ["config", "routes"],
      invalid: [],
    });
  });

  it("reports invalid section names", () => {
    expect(parseSectionsParameter("config,secrets")).toEqual({
      ok: false,
      invalid: ["secrets"],
    });
  });
});

describe("selectManifestSections", () => {
  const manifest = buildManifestData({ config, routeMetadata: {} }).manifest;

  it("returns every section when no filter is given", () => {
    const selected = selectManifestSections(manifest, undefined);
    expect(Object.keys(selected).toSorted()).toEqual(
      ["blocks", "framework", "i18n", "project", "routes", "schema"].toSorted(),
    );
  });

  it("maps config -> project and meta -> framework", () => {
    expect(selectManifestSections(manifest, ["config"])).toEqual({ project: manifest.project });
    expect(selectManifestSections(manifest, ["meta"])).toEqual({ framework: manifest.framework });
  });

  it("returns only the requested sections", () => {
    expect(Object.keys(selectManifestSections(manifest, ["routes", "schema"]))).toEqual([
      "routes",
      "schema",
    ]);
  });

  it("exposes the canonical section list", () => {
    expect(ALL_MANIFEST_SECTIONS).toEqual(["config", "blocks", "routes", "schema", "i18n", "meta"]);
  });
});
