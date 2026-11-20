// The generated project installs with the npm the IDE vendors (D-032), and its
// @facilis.dev/* packages install from the npm registry at each package's own committed
// version (D-166/D-198). Both halves are cross-file invariants that fail at install time
// in a confusing place if they drift: a version bump in one place only, or a dependency
// the template lists but the example does not carry.

import { describe, expect, it } from "vitest";
// Raw import, not node:fs: the IDE's app tsconfig has no Node types (it is a browser
// build), and ?raw reads the file through Vite's loader, which vitest also serves.
import assetScript from "../../../scripts/dev/vendor-assets.sh?raw";
import type { FacilisManifest } from "./facilis-template";
import { frameworkPackageMinimums } from "@/deploy/current";
import { openDeployment } from "@/deploy/resolve";
import { examplePackageJson } from "./example-template";
import { createFacilisTemplate, TEMPLATE_PACKAGES } from "./facilis-template";
import { fullstackPackageJson } from "./fullstack-files";
import { localPackageSpec } from "./local-packages";
import { projectFiles } from "./project-files";
import { staticPackageJson } from "./static-files";
import { LOCAL_PACKAGES_NPMRC, projectFileTemplates } from "./template-files";

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

  it("pins every @facilis.dev/* package to its own released version", () => {
    const deps = generatedPackageJson().dependencies;
    for (const name of PACKAGES) {
      // The build compiles the table from packages/*/package.json (D-198); the template
      // must never float a range or leak the example's workspace: spec.
      const minimum = frameworkPackageMinimums["@facilis.dev/" + name];
      expect(minimum).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
      expect(deps["@facilis.dev/" + name]).toBe(minimum);
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

// The dev local path (issue #41, D-196) is opt-in per build: the compiled flag is false
// under Vitest, so the release-mode guards above hold by default. These exercise the
// rewritten manifest explicitly, the way a dev build with the path enabled produces it.
describe("dev local packages manifest (issue #41)", () => {
  it("pins a file: spec for every framework package in local mode", () => {
    const deps = (JSON.parse(fullstackPackageJson(examplePackageJson(), true)) as PackageJson)
      .dependencies;
    for (const name of PACKAGES) {
      expect(deps["@facilis.dev/" + name]).toBe(localPackageSpec("@facilis.dev/" + name));
    }
    expect(JSON.stringify(deps)).toContain("file:./vendor/facilis/");
  });

  it("leaves non-framework dependencies untouched in local mode", () => {
    const local = JSON.parse(fullstackPackageJson(examplePackageJson(), true)) as PackageJson;
    const release = JSON.parse(fullstackPackageJson(examplePackageJson(), false)) as PackageJson;
    const react = Object.keys(release.dependencies).find((n) => !n.startsWith("@facilis.dev/"));
    expect(react).toBeDefined();
    expect(local.dependencies[react as string]).toBe(release.dependencies[react as string]);
  });

  it("still pins the exact published version in release mode", () => {
    const deps = (JSON.parse(fullstackPackageJson(examplePackageJson(), false)) as PackageJson)
      .dependencies;
    for (const name of PACKAGES) {
      expect(deps["@facilis.dev/" + name]).toBe(frameworkPackageMinimums["@facilis.dev/" + name]);
    }
  });

  it("copies file: directory deps via install-links in local mode, not in release", () => {
    // npm symlinks a file: directory dep by default; the in-VM Vite then resolves the real
    // path outside the preview scope. install-links copies it into node_modules (issue #41).
    const bodies = { packageJson: "{}\n", readme: "", tsconfigInclude: [] as readonly string[] };
    const local = projectFileTemplates(openDeployment(), "v", bodies, true);
    const release = projectFileTemplates(openDeployment(), "v", bodies, false);
    expect(local[".npmrc"]).toContain("install-links=true");
    expect(release[".npmrc"]).not.toContain("install-links");
    expect(LOCAL_PACKAGES_NPMRC).toContain("install-links=true");
  });

  it("rewrites the static wrapper's framework deps in local mode too", () => {
    const source = JSON.stringify({
      dependencies: { "@facilis.dev/core": "0.1.0", react: "19.3.0" },
    });
    const local = JSON.parse(staticPackageJson(source, true)) as PackageJson;
    const release = JSON.parse(staticPackageJson(source, false)) as PackageJson;
    expect(local.dependencies["@facilis.dev/core"]).toBe("file:./vendor/facilis/core");
    expect(release.dependencies["@facilis.dev/core"]).toBe(
      frameworkPackageMinimums["@facilis.dev/core"],
    );
    expect(local.dependencies.react).toBe("19.3.0");
  });
});
