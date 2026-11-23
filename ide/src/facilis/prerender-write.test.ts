import { describe, expect, it } from "vitest";
import type { IdeController } from "@/vv/controller";
import { writePrerenderDeclaration } from "./prerender-write";

const ROOT = "/w/app";
const CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  i18n: { defaultLocale: "en", locales: ["en"] },
});
`;

const VITE = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`;

function fakeController(files: Record<string, string>, failWrite = false) {
  const writes: { path: string; contents: string }[] = [];
  const controller = {
    readFileText: async (path: string) => files[path] ?? "",
    pathInfo: async (path: string) => ({ exists: path in files, isDir: false }),
    bridge: {
      request: async (type: string, extra?: Record<string, unknown>) => {
        if (type !== "vv-write") return { ok: false, error: "unexpected " + type };
        if (failWrite) return { ok: false, error: "disk full" };
        const path = String(extra?.path ?? "");
        const contents = String(extra?.contents ?? "");
        writes.push({ path, contents });
        files[path] = contents;
        return { ok: true };
      },
    },
  };
  return { controller: controller as unknown as IdeController, writes, files };
}

describe("writePrerenderDeclaration", () => {
  it("writes the config allowlist through vv-write when facilis.config.ts exists", async () => {
    const { controller, writes, files } = fakeController({
      [ROOT + "/facilis.config.ts"]: CONFIG,
      [ROOT + "/vite.config.ts"]: VITE,
    });
    const result = await writePrerenderDeclaration(controller, ROOT, "/about", true);
    expect(result).toEqual({ ok: true, file: ROOT + "/facilis.config.ts" });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(ROOT + "/facilis.config.ts");
    expect(files[ROOT + "/facilis.config.ts"]).toContain('prerender: { routes: ["/about"] },');
    // The Vite config is untouched while a config file exists.
    expect(files[ROOT + "/vite.config.ts"]).toBe(VITE);
  });

  it("removes the route again on toggle-off", async () => {
    const { controller, files } = fakeController({ [ROOT + "/facilis.config.ts"]: CONFIG });
    await writePrerenderDeclaration(controller, ROOT, "/about", true);
    const result = await writePrerenderDeclaration(controller, ROOT, "/about", false);
    expect(result.ok).toBe(true);
    expect(files[ROOT + "/facilis.config.ts"]).toContain("prerender: { routes: [] },");
  });

  it("falls back to the vite.config.ts plugin option for a static project", async () => {
    const { controller, writes, files } = fakeController({ [ROOT + "/vite.config.ts"]: VITE });
    const result = await writePrerenderDeclaration(controller, ROOT, "/about", true);
    expect(result).toEqual({ ok: true, file: ROOT + "/vite.config.ts" });
    expect(writes[0]?.path).toBe(ROOT + "/vite.config.ts");
    expect(files[ROOT + "/vite.config.ts"]).toContain(
      'import { prerender } from "@facilis.dev/nitro/prerender";',
    );
    expect(files[ROOT + "/vite.config.ts"]).toContain('prerender({ routes: ["/about"] })');
  });

  it("rejects a param-bearing or relative path without writing", async () => {
    const { controller, writes } = fakeController({ [ROOT + "/facilis.config.ts"]: CONFIG });
    for (const route of ["/todos/:id", "about", "/a//b", "/x/", "/q?y=1"]) {
      const result = await writePrerenderDeclaration(controller, ROOT, route, true);
      expect(result.ok, route).toBe(false);
    }
    expect(writes).toHaveLength(0);
  });

  it("fails with an explanation when neither declaration file exists", async () => {
    const { controller, writes } = fakeController({});
    const result = await writePrerenderDeclaration(controller, ROOT, "/about", true);
    expect(result.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("fails closed when the config cannot be edited safely", async () => {
    const { controller, writes } = fakeController({
      [ROOT + "/facilis.config.ts"]: "export const x = 1;\n",
    });
    const result = await writePrerenderDeclaration(controller, ROOT, "/about", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("facilis.config.ts");
    expect(writes).toHaveLength(0);
  });

  it("surfaces a kernel write failure", async () => {
    const { controller } = fakeController({ [ROOT + "/facilis.config.ts"]: CONFIG }, true);
    const result = await writePrerenderDeclaration(controller, ROOT, "/about", true);
    expect(result).toEqual({ ok: false, error: "disk full" });
  });

  it("does not write when the route is already declared", async () => {
    const { controller, writes } = fakeController({ [ROOT + "/facilis.config.ts"]: CONFIG });
    await writePrerenderDeclaration(controller, ROOT, "/about", true);
    const again = await writePrerenderDeclaration(controller, ROOT, "/about", true);
    expect(again.ok).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
