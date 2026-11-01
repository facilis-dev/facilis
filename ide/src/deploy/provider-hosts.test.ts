import { describe, expect, it } from "vitest";
import { PRESETS } from "../ai/providers";
import { PROVIDER_BASE_URLS } from "./provider-hosts";

describe("provider hosts", () => {
  it("matches the presets' base URLs", () => {
    for (const preset of PRESETS) {
      if (preset.baseUrl === "") continue;
      expect(PROVIDER_BASE_URLS[preset.id]).toBe(preset.baseUrl);
    }
  });

  it("has no stale entries", () => {
    const presetIds = new Set(PRESETS.map((preset) => preset.id));
    for (const id of Object.keys(PROVIDER_BASE_URLS)) {
      expect(presetIds.has(id)).toBe(true);
    }
  });
});
