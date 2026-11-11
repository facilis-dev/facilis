import { describe, expect, it } from "vitest";

import * as nitro from "./index.ts";

describe("@facilis.dev/nitro public surface", () => {
  it("exposes the Vite plugin, the Nitro module and the route metadata adapter", () => {
    expect(nitro.facilis).toBeTypeOf("function");
    expect(nitro.facilisNitroModule.name).toBe("facilis");
    expect(nitro.scanRouteMetadata).toBeTypeOf("function");
    expect(nitro.mergeOpenApiMetadata).toBeTypeOf("function");
  });

  it("exposes the documented entry points on the package", async () => {
    const viteEntry = await import("./vite.ts");
    const moduleEntry = await import("./module.ts");
    expect(viteEntry.facilis).toBe(nitro.facilis);
    expect(moduleEntry.facilisNitroModule).toBe(nitro.facilisNitroModule);
  });
});
