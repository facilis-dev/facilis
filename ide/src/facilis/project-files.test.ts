// The generated project has ONE config file: Nitro's options live in facilis.config.ts
// and facilis() mounts Nitro (SPEC Appendix B, D-034). These are string templates, so
// nothing typechecks them at build time — a stale `nitro.config.ts` or a re-added nitro
// import would only surface as a scaffold that does not boot in the WebContainer.

import { describe, expect, it } from "vitest";
import { createFacilisTemplate } from "./facilis-template";
import { projectFiles } from "./project-files";

const files = createFacilisTemplate().files;

type PackageJson = { devDependencies: Record<string, string> };
type Tsconfig = { include: string[] };

function parse<T>(name: string): T {
  return JSON.parse(projectFiles()[name]) as T;
}

describe("generated project config", () => {
  it("ships no nitro.config.ts", () => {
    expect(projectFiles()).not.toHaveProperty("nitro.config.ts");
  });

  it("never imports Nitro in vite.config.ts; facilis() mounts it", () => {
    const viteConfig = files["vite.config.ts"];
    expect(viteConfig).not.toMatch(/from ["']nitro/);
    expect(viteConfig).not.toContain("nitro(");
    expect(viteConfig).toContain("plugins: [facilis(), react()]");
  });

  it("keeps the in-VM Nitro runner in facilis.config.ts", () => {
    // The default node-worker runner needs worker_threads + import.meta.resolve, which
    // the WebContainer does not provide; without runner "self" vite dev never serves.
    expect(files["facilis.config.ts"]).toMatch(
      /nitro:\s*\{\s*devServer:\s*\{\s*runner:\s*"self"\s*\}\s*\}/,
    );
  });

  it("installs React's type packages for Monaco IntelliSense", () => {
    // The IDE feeds installed @types/*.d.ts to Monaco's TS service; without these the
    // template's src/App.tsx reports TS2307 "Cannot find module 'react'".
    const devDependencies = parse<PackageJson>("package.json").devDependencies;
    expect(devDependencies["@types/react"]).toBe("19.3.0");
    expect(devDependencies["@types/react-dom"]).toBe("19.3.0");
  });

  it("lists no nitro.config.ts in tsconfig's include", () => {
    const include = parse<Tsconfig>("tsconfig.json").include;
    expect(include).not.toContain("nitro.config.ts");
    expect(include).toContain("facilis.config.ts");
  });
});
