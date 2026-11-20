import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublishable,
  compareSemver,
  headlineVersion,
  parseSemver,
  pinWorkspace,
  publishedMetadata,
  renderReleaseLedger,
  resolveReleaseSet,
  stagePackage,
  verifyReleaseLedger,
} from "./publish-packages.mjs";

const manifest = (name: string, version: string) => ({ name, version });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveReleaseSet", () => {
  it("publishes exactly the committed versions, sorted by name", () => {
    const set = resolveReleaseSet([
      manifest("@facilis.dev/db", "0.2.0"),
      manifest("@facilis.dev/core", "0.1.10"),
    ]);
    expect(set).toEqual([
      { name: "@facilis.dev/core", version: "0.1.10" },
      { name: "@facilis.dev/db", version: "0.2.0" },
    ]);
  });

  it("accepts prerelease and build metadata", () => {
    expect(resolveReleaseSet([manifest("@facilis.dev/core", "1.2.3-beta.1+build.5")])).toEqual([
      { name: "@facilis.dev/core", version: "1.2.3-beta.1+build.5" },
    ]);
  });

  it("refuses the 0.0.0 placeholder", () => {
    expect(() => resolveReleaseSet([manifest("@facilis.dev/core", "0.0.0")])).toThrow(
      /placeholder/,
    );
  });

  it("refuses unparseable versions", () => {
    for (const version of ["1.2", "latest", "", undefined]) {
      expect(() => resolveReleaseSet([{ name: "@facilis.dev/core", version }])).toThrow(
        /not semver/,
      );
    }
  });

  it("refuses duplicate names, foreign scopes and an empty set", () => {
    expect(() =>
      resolveReleaseSet([
        manifest("@facilis.dev/core", "0.1.10"),
        manifest("@facilis.dev/core", "0.2.0"),
      ]),
    ).toThrow(/duplicate/);
    expect(() => resolveReleaseSet([manifest("react", "19.0.0")])).toThrow(/not a @facilis.dev/);
    expect(() => resolveReleaseSet([])).toThrow(/no @facilis.dev/);
  });
});

describe("assertPublishable", () => {
  const set = [
    { name: "@facilis.dev/core", version: "0.1.10" },
    { name: "@facilis.dev/db", version: "0.2.0" },
  ];

  it("passes for unpublished packages and for other existing versions", () => {
    expect(() => assertPublishable(set, {})).not.toThrow();
    expect(() =>
      assertPublishable(set, { "@facilis.dev/core": ["0.1.9"], "@facilis.dev/db": ["0.1.10"] }),
    ).not.toThrow();
  });

  it("refuses a version that already exists for that package", () => {
    expect(() => assertPublishable(set, { "@facilis.dev/core": ["0.1.10"] })).toThrow(
      /@facilis.dev\/core@0\.1\.10 already exists/,
    );
  });
});

describe("pinWorkspace", () => {
  it("pins each internal dep to the TARGET package's committed version", () => {
    const pinned = pinWorkspace(
      { "@facilis.dev/core": "workspace:*", "@facilis.dev/db": "workspace:^", zod: "4.6.7" },
      { "@facilis.dev/core": "0.1.10", "@facilis.dev/db": "0.2.0" },
    );
    expect(pinned).toEqual({
      "@facilis.dev/core": "0.1.10",
      "@facilis.dev/db": "0.2.0",
      zod: "4.6.7",
    });
  });

  it("refuses a workspace dep outside the release set and passes undefined through", () => {
    expect(() => pinWorkspace({ "@facilis.dev/ai": "workspace:*" }, {})).toThrow(
      /not in the release set/,
    );
    expect(pinWorkspace(undefined, {})).toBeUndefined();
  });
});

describe("semver helpers and the headline", () => {
  it("parses and compares", () => {
    expect(parseSemver("0.1.10")).toEqual([0, 1, 10]);
    expect(parseSemver("nope")).toBeNull();
    expect(compareSemver([0, 2, 0], [0, 1, 10])).toBeGreaterThan(0);
    expect(compareSemver([0, 1, 10], [0, 1, 10])).toBe(0);
  });

  it("headline is the highest committed version of the set", () => {
    expect(
      headlineVersion([
        { name: "@facilis.dev/core", version: "0.1.10" },
        { name: "@facilis.dev/db", version: "0.2.0" },
        { name: "@facilis.dev/ai", version: "0.1.9" },
      ]),
    ).toBe("0.2.0");
  });
});

describe("release ledger", () => {
  const set = [
    { name: "@facilis.dev/core", version: "0.1.10" },
    { name: "@facilis.dev/db", version: "0.2.0" },
  ];

  it("renders one name@version line per package", () => {
    expect(renderReleaseLedger(set)).toBe("@facilis.dev/core@0.1.10\n@facilis.dev/db@0.2.0");
  });

  it("verifies a release body names every published name@version", () => {
    const body =
      "## What's Changed\n\nPublished set:\n" + renderReleaseLedger(set) + "\n\nFull changelog";
    expect(verifyReleaseLedger(body, set)).toEqual({ ok: true, missing: [] });
  });

  it("reports the entries a body misses", () => {
    expect(verifyReleaseLedger("only @facilis.dev/core@0.1.10", set)).toEqual({
      ok: false,
      missing: ["@facilis.dev/db@0.2.0"],
    });
  });
});

describe("publishedMetadata (mocked registry)", () => {
  it("returns null on 404 and the packument on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404 })),
    );
    expect(await publishedMetadata("@facilis.dev/core")).toBeNull();
    const doc = { versions: { "0.1.10": {} }, "dist-tags": { latest: "0.1.10" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, ok: true, json: async () => doc })),
    );
    expect(await publishedMetadata("@facilis.dev/core")).toEqual(doc);
  });

  it("throws on a registry error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 500, ok: false })),
    );
    await expect(publishedMetadata("@facilis.dev/core")).rejects.toThrow(/HTTP 500/);
  });
});

describe("stagePackage (fixture tree)", () => {
  it("stages the committed version with per-package pins and no test artifacts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facilis-stage-fixture-"));
    let stage: string | undefined;
    try {
      fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
      fs.mkdirSync(path.join(dir, "src", "test-fixtures"), { recursive: true });
      fs.writeFileSync(path.join(dir, "dist", "index.js"), "export {};\n");
      fs.writeFileSync(path.join(dir, "dist", "index.d.ts"), 'export { x } from "./inner.ts";\n');
      fs.writeFileSync(path.join(dir, "dist", "index.test.js"), "test artifact\n");
      fs.writeFileSync(path.join(dir, "src", "index.ts"), "export {};\n");
      fs.writeFileSync(path.join(dir, "src", "index.test.ts"), "test artifact\n");
      fs.writeFileSync(path.join(dir, "src", "test-fixtures", "a.ts"), "fixture\n");
      fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n");
      const pkgManifest = {
        name: "@facilis.dev/fixture",
        version: "0.3.0",
        exports: { ".": "./src/index.ts", "./package.json": "./package.json" },
        dependencies: { "@facilis.dev/core": "workspace:*", zod: "4.6.7" },
        devDependencies: { vitest: "catalog:" },
        scripts: { test: "vitest run" },
      };
      const result = stagePackage(
        { dir, name: pkgManifest.name, manifest: pkgManifest },
        { "@facilis.dev/fixture": "0.3.0", "@facilis.dev/core": "0.1.10" },
      );
      stage = result.stage;
      const staged = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8"));
      expect(staged.version).toBe("0.3.0");
      expect(staged.dependencies).toEqual({ "@facilis.dev/core": "0.1.10", zod: "4.6.7" });
      expect(staged.exports["."]).toBe("./dist/index.js");
      expect(staged.main).toBe("./dist/index.js");
      expect(staged.types).toBe("./dist/index.d.ts");
      expect(staged.devDependencies).toBeUndefined();
      expect(staged.scripts).toBeUndefined();
      expect(fs.existsSync(path.join(stage, "dist", "index.test.js"))).toBe(false);
      expect(fs.existsSync(path.join(stage, "src", "index.test.ts"))).toBe(false);
      expect(fs.existsSync(path.join(stage, "src", "test-fixtures"))).toBe(false);
      expect(fs.existsSync(path.join(stage, "README.md"))).toBe(true);
      expect(fs.existsSync(path.join(stage, "LICENSE"))).toBe(true);
      expect(fs.readFileSync(path.join(stage, "dist", "index.d.ts"), "utf8")).toContain(
        '"./inner.js"',
      );
    } finally {
      if (stage) fs.rmSync(stage, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
