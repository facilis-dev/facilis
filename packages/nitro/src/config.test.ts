import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NITRO_OPTIONS,
  loadFacilisConfig,
  loadNitroOptions,
  mergeNitroOptions,
} from "./config.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));
const absentRoot = fileURLToPath(new URL("../test-fixtures/absent", import.meta.url));
const invalidRoot = fileURLToPath(new URL("../test-fixtures/invalid-config", import.meta.url));

describe("mergeNitroOptions", () => {
  it("uses the Facilis defaults when the project declares nothing", () => {
    expect(mergeNitroOptions(undefined)).toEqual(DEFAULT_NITRO_OPTIONS);
  });

  it("merges deep so one nested switch does not drop its siblings", () => {
    expect(mergeNitroOptions({ experimental: { openAPI: false } })).toEqual({
      serverDir: "./server",
      experimental: { openAPI: false },
    });
  });

  it("keeps unknown Nitro options and replaces lists instead of concatenating them", () => {
    const options = mergeNitroOptions({
      devServer: { runner: "self" },
      modules: ["a"],
      plugins: [],
    });

    expect(options["devServer"]).toEqual({ runner: "self" });
    expect(options["modules"]).toEqual(["a"]);
    expect(options["plugins"]).toEqual([]);
  });

  it("returns a fresh object and never mutates the framework defaults", () => {
    const options = mergeNitroOptions({ serverDir: "./api" });
    expect(options).not.toBe(DEFAULT_NITRO_OPTIONS);
    expect(DEFAULT_NITRO_OPTIONS["serverDir"]).toBe("./server");
    // The nested default object is cloned too, so a caller's edit cannot leak across starts.
    expect(options["experimental"]).not.toBe(DEFAULT_NITRO_OPTIONS["experimental"]);
  });
});

describe("loading a project's config", () => {
  it("reads facilis.config.ts and its nitro section", async () => {
    const config = await loadFacilisConfig(projectRoot);

    expect(config?.auth.defaultRole).toBe("user");
    expect(config?.nitro).toEqual({ devServer: { runner: "self" } });
  });

  it("merges the project's options over the defaults", async () => {
    expect(await loadNitroOptions(projectRoot)).toEqual({
      serverDir: "./server",
      experimental: { openAPI: true },
      devServer: { runner: "self" },
    });
  });

  it("returns null when the project has no config file, so the framework defaults stand", async () => {
    expect(await loadFacilisConfig(absentRoot)).toBeNull();
    expect(await loadNitroOptions(absentRoot)).toEqual(DEFAULT_NITRO_OPTIONS);
  });

  it("names the file and the schema violation when the config is invalid", async () => {
    await expect(loadFacilisConfig(invalidRoot)).rejects.toThrow(/invalid .*facilis\.config\.ts/);
  });
});
