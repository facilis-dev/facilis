// The generated project installs with the npm the IDE vendors (D-032), and its
// @facilis.dev/* packages install from the npm registry at the exact published version
// this build pins (D-166). Both halves are cross-file invariants that fail at install time
// in a confusing place if they drift: a version bump in one place only, or a dependency
// the template lists but the example does not carry.

import { describe, expect, it } from "vitest";
// Raw import, not node:fs: the IDE's app tsconfig has no Node types (it is a browser
// build), and ?raw reads the file through Vite's loader, which vitest also serves.
import assetScript from "../../../scripts/dev/vendor-assets.sh?raw";
import type { FacilisManifest } from "./facilis-template";
import { createFacilisTemplate, TEMPLATE_PACKAGES } from "./facilis-template";
import { projectFiles } from "./project-files";

const PACKAGES = TEMPLATE_PACKAGES;

function vendoredNpmVersion(): string {
  const match = /^NPM_VERSION=(\S+)$/m.exec(assetScript);
  if (!match) throw new Error("NPM_VERSION not found in scripts/dev/vendor-assets.sh");
  return match[1];
}

type PackageJson = {
  packageManager: string;
  dependencies: Record<string, string>;
};

function generatedPackageJson(): PackageJson {
  return JSON.parse(projectFiles()["package.json"]) as PackageJson;
}

describe("generated project package manager", () => {
  it("pins exactly the npm the IDE vendors", () => {
    expect(generatedPackageJson().packageManager).toBe("npm@" + vendoredNpmVersion());
  });

  it("rejects any other package manager from the preinstall guard", () => {
    const guard = projectFiles()["scripts/check-pm.mjs"];
    expect(guard).toContain('agent.startsWith("npm/")');
    expect(guard).not.toContain("pnpm/");
  });

  it("pins every @facilis.dev/* package to the published version", () => {
    const deps = generatedPackageJson().dependencies;
    for (const name of PACKAGES) {
      // The fallback an unbundled build compiles in; the deploy pipeline injects the
      // exact published version (D-166), and the template must never float a range.
      expect(deps["@facilis.dev/" + name]).toBe("0.1.0");
    }
  });

  it("declares exactly the @facilis.dev packages the template lists", () => {
    // Parities both ways: a package added to the example but not to TEMPLATE_PACKAGES (or
    // the reverse) would be installed without being analysed, or the opposite.
    const declared = Object.keys(generatedPackageJson().dependencies)
      .filter((name) => name.startsWith("@facilis.dev/"))
      .toSorted();
    const listed = PACKAGES.map((name) => "@facilis.dev/" + name).toSorted();
    expect(declared).toEqual(listed);
  });

  it("installs with a plain npm install and ships no vendor pre-step", () => {
    expect(createFacilisTemplate().manifest.install).toBe("npm install");
    expect(projectFiles()).not.toHaveProperty("scripts/vendor-paths.cjs");
    const readme = projectFiles()["README.md"];
    expect(readme).not.toContain("./vendor");
    expect(readme).not.toContain("vendor-paths");
  });

  it("ships no binary assets and no vendor/ file", () => {
    const template = createFacilisTemplate();
    const assets = (template.manifest as FacilisManifest).assets;
    expect(assets).toEqual([]);
    expect(Object.keys(template.files).some((path) => path.startsWith("vendor/"))).toBe(false);
    expect(JSON.stringify(generatedPackageJson())).not.toContain("file:./vendor");
  });
});
