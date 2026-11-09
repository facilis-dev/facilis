import { describe, expect, it } from "vitest";
import {
  APP_MANIFEST_FILE,
  admitsProject,
  parseAppManifest,
  renderAppManifest,
} from "./app-manifest";

const VERSION = "2026.11";

describe(".facilis/facilis.app.json", () => {
  it("names the project and the environment that created it", () => {
    const parsed = parseAppManifest(renderAppManifest(VERSION, new Date("2026-11-01T10:00:00Z")));
    expect(APP_MANIFEST_FILE).toBe(".facilis/facilis.app.json");
    expect(parsed).toEqual({
      schemaVersion: 1,
      template: "facilis",
      templateVersion: VERSION,
      environmentVersion: VERSION,
      createdAt: "2026-11-01T10:00:00.000Z",
    });
  });

  it("rejects a marker from another tool, another schema, or garbage", () => {
    expect(parseAppManifest("not json")).toBeNull();
    expect(parseAppManifest('{"schemaVersion":2,"template":"facilis"}')).toBeNull();
    expect(parseAppManifest('{"schemaVersion":1,"template":"other"}')).toBeNull();
    expect(parseAppManifest('{"schemaVersion":1,"template":"facilis"}')).toBeNull();
  });

  it("gates only a managed facilis-only deployment", () => {
    const marker = renderAppManifest(VERSION);
    expect(admitsProject({ profile: "open", admission: "facilis-only", marker: null })).toBe(true);
    expect(admitsProject({ profile: "managed", admission: "any", marker: null })).toBe(true);
    expect(admitsProject({ profile: "managed", admission: "facilis-only", marker })).toBe(true);
    expect(admitsProject({ profile: "managed", admission: "facilis-only", marker: null })).toBe(
      false,
    );
    expect(admitsProject({ profile: "managed", admission: "facilis-only", marker: "{}" })).toBe(
      false,
    );
  });

  it("does not treat a version mismatch as a refusal (that is the update checker)", () => {
    const older = renderAppManifest("2026.10");
    expect(admitsProject({ profile: "managed", admission: "facilis-only", marker: older })).toBe(
      true,
    );
  });
});
