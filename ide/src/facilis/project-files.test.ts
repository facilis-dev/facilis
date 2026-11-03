// The generated project has ONE config file: Nitro's options live in facilis.config.ts
// and facilis() mounts Nitro (SPEC Appendix B, D-034). These are string templates, so
// nothing typechecks them at build time — a stale `nitro.config.ts` or a re-added nitro
// import would only surface as a scaffold that does not boot in the WebContainer.

import { describe, expect, it } from "vitest";
import { resolveDeployment } from "@/deploy/resolve";
import { createFacilisTemplate } from "./facilis-template";
import { projectFiles } from "./project-files";

const files = createFacilisTemplate().files;

type PackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
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
    // The v2 styling layer plus its VM rescan workaround run in the same Vite dev server.
    expect(viteConfig).toContain(
      "plugins: [tailwindcss(), tailwindRescanInVm(), facilis(), react()]",
    );
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
    // vite-plugins/tailwind-rescan.ts imports node:path and reads process.arch, so
    // without the node types Monaco reports TS2307/TS2580 on a file the template ships.
    expect(devDependencies["@types/node"]).toBe("22.20.5");
  });

  it("typechecks the template's own config and vite-plugins sources", () => {
    const tsconfig = parse<Tsconfig & { compilerOptions: { types: string[] } }>("tsconfig.json");
    expect(tsconfig.include).not.toContain("nitro.config.ts");
    expect(tsconfig.include).toContain("facilis.config.ts");
    // The template's top-level vite-plugins/ folder must be typechecked with the project.
    expect(tsconfig.include).toContain("vite-plugins");
    // vite-plugins/tailwind-rescan.ts imports node:path and reads process.arch, so the
    // generated project needs node's globals as well as Vite's.
    expect(tsconfig.compilerOptions.types).toEqual(["vite/client", "node"]);
  });

  it("pins the Tailwind toolchain and the VM-only oxide binding to one version", () => {
    // Tailwind CSS v4 is the v2 template's styling layer. The wasm32 oxide binding is
    // generated-project only: the VM reports process.arch "wasm32", so it resolves there,
    // while the same dependency breaks the host install with EBADPLATFORM.
    const devDependencies = parse<PackageJson>("package.json").devDependencies;
    const tailwindcss = devDependencies["tailwindcss"];
    expect(tailwindcss).toBe("4.3.3");
    expect(devDependencies["@tailwindcss/vite"]).toBe(tailwindcss);
    expect(devDependencies["@tailwindcss/oxide-wasm32-wasi"]).toBe(tailwindcss);
  });

  it("never ships the v1 @facilis/ui kit in the generated package.json", () => {
    // Template v2 copies its shadcn-style primitives into src/components/ui, so the kit is
    // neither a dependency nor a vendored tarball: there is nothing to install or fetch.
    const pkg = parse<PackageJson>("package.json");
    expect(pkg.dependencies["@facilis/ui"]).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toContain("facilis-ui-");
    expect(Object.keys(pkg.dependencies)).toContain("@base-ui/react");
  });

  it("keeps the VM npm flags and adds no registry for the open profile", () => {
    // The IDE cannot pass npm flags except through this file: audit/update-notifier
    // are registry calls the container pays for and fund/progress are noise the IDE
    // mirrors into the browser.
    const open = projectFiles()[".npmrc"];
    for (const flag of ["audit=false", "fund=false", "progress=false", "update-notifier=false"]) {
      expect(open).toContain(flag);
    }
    expect(open).not.toContain("registry=");
  });

  it("writes the deployment's mirror into the generated .npmrc", () => {
    const managed = resolveDeployment({
      profile: "managed",
      company: { name: "Acme", domain: "facilis.acme.example" },
      packages: { registry: "https://npm.acme.example" },
      projects: { preview: { origin: "https://preview.facilis.acme.example" } },
    });
    const npmrc = projectFiles(managed)[".npmrc"];
    expect(npmrc).toContain("registry=https://npm.acme.example");
    for (const flag of ["audit=false", "fund=false", "progress=false", "update-notifier=false"]) {
      expect(npmrc).toContain(flag);
    }
  });

  it("writes the admission marker with the build's environment version", () => {
    const marker = JSON.parse(projectFiles(undefined, "2026.11")["facilis.app.json"]) as {
      schemaVersion: number;
      template: string;
      environmentVersion: string;
    };
    expect(marker.schemaVersion).toBe(1);
    expect(marker.template).toBe("facilis");
    expect(marker.environmentVersion).toBe("2026.11");
  });
});
