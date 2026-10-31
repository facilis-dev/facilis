// The generated project installs with the npm the IDE vendors (D-032), and it finds
// its @facilis/* packages as file: dependencies inside ./vendor, inlined there by the
// IDE from the template's manifest assets. Both halves are cross-file invariants
// that fail at install time in a confusing place if they drift: a version bump in one
// place only, or an asset path that no longer matches the spec that names it.

import { describe, expect, it } from "vitest";
// Raw import, not node:fs: the IDE's app tsconfig has no Node types (it is a browser
// build), and ?raw reads the file through Vite's loader, which vitest also serves.
import assetScript from "../../../scripts/dev/vendor-assets.sh?raw";
import type { FacilisManifest } from "./facilis-template";
import { createFacilisTemplate } from "./facilis-template";
import { projectFiles } from "./project-files";

const PACKAGES = ["auth", "core", "db", "nitro"] as const;

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

  it("declares @facilis/* as file: tarballs inside the project", () => {
    const deps = generatedPackageJson().dependencies;
    for (const name of PACKAGES) {
      expect(deps["@facilis/" + name]).toBe("file:./vendor/facilis-" + name + "-0.0.0.tgz");
    }
  });

  it("resolves the vendored tarballs to absolute paths before npm runs", () => {
    // The specs ship relative (portable), but npm's re-derivation of a relative file:
    // target broke inside the VM, so the install command must run the resolver first —
    // and the resolver is a real file of the generated project, not a manifest promise.
    expect(projectFiles()["scripts/vendor-paths.cjs"]).toContain("process.cwd()");
    expect(createFacilisTemplate().manifest.install).toBe(
      "node scripts/vendor-paths.cjs && npm install",
    );
  });

  it("ships the tarball the IDE inlines under the path the spec names", () => {
    const assets = (createFacilisTemplate().manifest as FacilisManifest).assets;
    for (const name of PACKAGES) {
      const asset = assets.find((a) => a.path === "vendor/facilis-" + name + "-0.0.0.tgz");
      expect(asset, "missing asset for @facilis/" + name).toBeDefined();
      // Same basename, and the served file is the one the IDE publishes.
      expect(asset?.asset).toBe("vendor/facilis/facilis-" + name + "-0.0.0.tgz");
    }
  });
});
