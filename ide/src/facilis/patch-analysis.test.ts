import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { overlayPatches } from "./patch-analysis";

const BASE = new Map([
  ["facilis.config.ts", "export default defineConfig({});"],
  ["db/schema.ts", 'export const todos = pgTable("todos", {});'],
  ["src/lib/api.ts", "export const api = createApi();"],
]);

describe("overlayPatches", () => {
  it("writes create/update content and removes deleted paths", () => {
    const patches: FilePatch[] = [
      { path: "src/lib/api.ts", action: "update", content: "export const api = patched();" },
      { path: "db/schema.ts", action: "delete" },
      { path: "src/pages/new.tsx", action: "create", content: "export const Page = () => null;" },
    ];
    const files = overlayPatches(BASE, patches);
    expect(files.get("src/lib/api.ts")).toBe("export const api = patched();");
    expect(files.has("db/schema.ts")).toBe(false);
    expect(files.get("src/pages/new.tsx")).toBe("export const Page = () => null;");
    expect(files.get("facilis.config.ts")).toBe(BASE.get("facilis.config.ts"));
  });

  it("adds a patched file the analyzer selection did not read", () => {
    const patches: FilePatch[] = [
      { path: "components/root-button.tsx", action: "create", content: "export const B = 1;" },
    ];
    const files = overlayPatches(BASE, patches);
    expect(files.get("components/root-button.tsx")).toBe("export const B = 1;");
  });

  it("normalizes a leading ./ or /", () => {
    const files = overlayPatches(BASE, [
      { path: "./src/lib/api.ts", action: "update", content: "dot" },
      { path: "/src/extra.ts", action: "create", content: "slash" },
    ]);
    expect(files.get("src/lib/api.ts")).toBe("dot");
    expect(files.has("./src/lib/api.ts")).toBe(false);
    expect(files.get("src/extra.ts")).toBe("slash");
  });

  it("leaves the base map untouched", () => {
    const base = new Map(BASE);
    const files = overlayPatches(base, [
      { path: "src/lib/api.ts", action: "update", content: "changed" },
      { path: "src/other.ts", action: "create", content: "new" },
    ]);
    expect(files).not.toBe(base);
    expect(base.get("src/lib/api.ts")).toBe("export const api = createApi();");
    expect(base.has("src/other.ts")).toBe(false);
  });

  it("ignores a contentless update and a delete of an absent path", () => {
    const files = overlayPatches(BASE, [
      { path: "src/lib/api.ts", action: "update" },
      { path: "src/gone.ts", action: "delete" },
    ]);
    expect(files.get("src/lib/api.ts")).toBe("export const api = createApi();");
    expect(files.size).toBe(BASE.size);
  });

  it("returns an equal map for an empty patch set", () => {
    const files = overlayPatches(BASE, []);
    expect([...files.entries()]).toEqual([...BASE.entries()]);
  });
});
