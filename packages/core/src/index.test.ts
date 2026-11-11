import { describe, expect, it } from "vitest";

import * as core from "./index.ts";

describe("@facilis.dev/core public surface", () => {
  it("exposes the SPEC §5.1 runtime API by name", () => {
    expect(core.defineConfig).toBeTypeOf("function");
    expect(core.defineAuthorizedHandler).toBeTypeOf("function");
    expect(core.buildManifest).toBeTypeOf("function");
    expect(core.summarizeManifest).toBeTypeOf("function");
    expect(core.computeRevision).toBeTypeOf("function");
    expect(core.t).toBeTypeOf("function");
    expect(core.registerCatalog).toBeTypeOf("function");
    expect(core.fail).toBeTypeOf("function");
    expect(core.facilisConfigSchema).toBeDefined();
    expect("default" in core).toBe(false);
  });

  it("works end-to-end through the public entry point", async () => {
    const config = core.defineConfig({
      auth: { permissions: ["todos:read"], roles: { user: ["todos:read"] }, defaultRole: "user" },
    });
    const manifest = core.buildManifest({ config, routes: [] });

    expect(core.summarizeManifest(manifest).counts.routes).toBe(0);
    expect(await core.computeRevision({ configContent: "export default {}" })).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });
});
