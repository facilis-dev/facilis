import { describe, expect, it } from "vitest";
import type { FileTree } from "./file-tree";
import { synthesizeManifest } from "./project-import";

const utf8 = (text: string) => new TextEncoder().encode(text);
const tree = (pkg: unknown, extra: string[] = []): FileTree => [
  { path: "package.json", bytes: utf8(JSON.stringify(pkg)) },
  ...extra.map((path) => ({ path, bytes: utf8("") })),
];

describe("synthesizeManifest", () => {
  it("returns null without a package.json or without a runnable script", () => {
    expect(synthesizeManifest([], "app")).toBeNull();
    expect(synthesizeManifest(tree({ name: "x" }), "app")).toBeNull();
    expect(synthesizeManifest(tree({ scripts: { test: "vitest" } }), "app")).toBeNull();
  });

  it("turns a vite dev script into an HMR manifest on 5173", () => {
    const m = synthesizeManifest(
      tree({ scripts: { dev: "vite" }, dependencies: { vite: "^7.1.0" } }, ["src/App.tsx"]),
      "app",
    );
    expect(m).toMatchObject({
      id: "imported",
      name: "app",
      dev: "npm run dev",
      port: 5173,
      hmr: true,
      reload: false,
      language: "TypeScript",
      entry: "src/App.tsx",
      install: "npm install",
    });
  });

  it("uses the start script verbatim and a reload server when not vite", () => {
    const m = synthesizeManifest(
      tree({ scripts: { start: "node server.js" } }, ["index.js", "README.md"]),
      "api",
    );
    expect(m).toMatchObject({
      dev: "npm start",
      port: 3000,
      hmr: false,
      reload: true,
      language: "JavaScript",
      entry: "index.js",
    });
  });

  it("detects TypeScript from dependencies even without a .ts file", () => {
    const m = synthesizeManifest(
      tree({ scripts: { dev: "vite" }, devDependencies: { typescript: "^5" } }),
      "app",
    );
    expect(m?.language).toBe("TypeScript");
  });
});
