import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import { GRAPH_EDGE_LABEL_KEYS, bridgeApexLabel, bridgeAriaLabel } from "./graph-edge-labels";

describe("bridge apex labels", () => {
  beforeEach(() => {
    initI18n();
    setLocale("en");
  });

  it("prefers the analyzer edge label over the kind name", () => {
    expect(bridgeApexLabel({ label: "todos -> projects.id", kind: "fk" })).toBe(
      "todos -> projects.id",
    );
  });

  it("falls back to the translated kind name when the fact is absent", () => {
    expect(bridgeApexLabel({ label: null, kind: "route-table" })).toBe("Route → table");
    setLocale("it");
    expect(bridgeApexLabel({ label: null, kind: "route-table" })).toBe("Route → tabella");
  });

  it("announces the apex label to screen readers in both locales", () => {
    expect(bridgeAriaLabel("dbTables")).toBe("Bridge: dbTables");
    setLocale("it");
    expect(bridgeAriaLabel("dbTables")).toBe("Ponte: dbTables");
  });

  it("keeps a catalogue key for every edge kind", () => {
    for (const kind of [
      "fk",
      "relation",
      "route-table",
      "page-route",
      "page-link",
      "route-view",
      "view-base",
    ] as const) {
      expect(GRAPH_EDGE_LABEL_KEYS[kind].length).toBeGreaterThan(0);
    }
  });
});
