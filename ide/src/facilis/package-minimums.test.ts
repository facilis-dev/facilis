// The D-198 pin check and rewrite: pure, with injected minimums so the tests do not
// depend on the versions the build happened to compile in.

import { describe, expect, it } from "vitest";
import {
  checkFrameworkPins,
  parsePackageJson,
  publishedFrameworkPin,
  rewriteFrameworkPins,
} from "./package-minimums";

const MINIMUMS = {
  "@facilis.dev/core": "0.1.10",
  "@facilis.dev/db": "0.2.0",
  "@facilis.dev/auth": "0.1.10",
};

function pkg(dependencies: Record<string, string>, devDependencies?: Record<string, string>) {
  return {
    name: "facilis-app",
    private: true,
    dependencies,
    ...(devDependencies ? { devDependencies } : {}),
  };
}

describe("checkFrameworkPins", () => {
  it("flags a pin below its own package's minimum", () => {
    const check = checkFrameworkPins(pkg({ "@facilis.dev/core": "0.1.9" }), MINIMUMS);
    expect(check.status).toBe("update-required");
    expect(check.below).toEqual([
      { name: "@facilis.dev/core", pinned: "0.1.9", minimum: "0.1.10" },
    ]);
  });

  it("passes a pin equal to the minimum", () => {
    expect(checkFrameworkPins(pkg({ "@facilis.dev/core": "0.1.10" }), MINIMUMS).status).toBe("ok");
  });

  it("passes a pin above the minimum", () => {
    expect(checkFrameworkPins(pkg({ "@facilis.dev/core": "0.2.3" }), MINIMUMS).status).toBe("ok");
  });

  it("compares each package against its own minimum (diverging versions)", () => {
    // db's minimum is ahead of core's: a core-current pin must not satisfy db.
    const check = checkFrameworkPins(
      pkg({ "@facilis.dev/core": "0.1.10", "@facilis.dev/db": "0.1.10" }),
      MINIMUMS,
    );
    expect(check.status).toBe("update-required");
    expect(check.below).toEqual([{ name: "@facilis.dev/db", pinned: "0.1.10", minimum: "0.2.0" }]);
  });

  it("reports several below-minimum pins at once", () => {
    const check = checkFrameworkPins(
      pkg({
        "@facilis.dev/core": "0.1.0",
        "@facilis.dev/db": "0.1.0",
        "@facilis.dev/auth": "0.1.10",
      }),
      MINIMUMS,
    );
    expect(check.status).toBe("update-required");
    expect(check.below.map((pin) => pin.name)).toEqual(["@facilis.dev/core", "@facilis.dev/db"]);
  });

  it("checks devDependencies too and dedupes a name present in both", () => {
    const check = checkFrameworkPins(
      pkg(
        { "@facilis.dev/core": "0.1.9" },
        { "@facilis.dev/core": "0.1.9", "@facilis.dev/db": "0.1.0" },
      ),
      MINIMUMS,
    );
    expect(check.below.map((pin) => pin.name)).toEqual(["@facilis.dev/core", "@facilis.dev/db"]);
  });

  it("passes file:, workspace: and link: specs (dev-local D-196, user-managed)", () => {
    for (const spec of [
      "file:./vendor/facilis/core",
      "workspace:*",
      "link:../core",
      "file:../packages/core",
    ]) {
      expect(checkFrameworkPins(pkg({ "@facilis.dev/core": spec }), MINIMUMS).status).toBe("ok");
    }
  });

  it("passes ranges, npm: aliases and prereleases (not exact released pins)", () => {
    for (const spec of [
      "^0.1.0",
      "~0.1.0",
      ">=0.1.0",
      "0.1.x",
      "*",
      "npm:@facilis.dev/core@0.1.0",
      "0.1.10-beta.1",
      "latest",
    ]) {
      expect(checkFrameworkPins(pkg({ "@facilis.dev/core": spec }), MINIMUMS).status).toBe("ok");
    }
  });

  it("passes a static template without framework deps", () => {
    expect(checkFrameworkPins(pkg({ react: "19.3.0", vite: "^8.0.0" }), MINIMUMS).status).toBe(
      "ok",
    );
  });

  it("passes missing, malformed or non-object package.json (admission handles those)", () => {
    for (const input of [null, undefined, "not json", 42, [], { dependencies: "nope" }]) {
      expect(checkFrameworkPins(input, MINIMUMS).status).toBe("ok");
    }
    expect(checkFrameworkPins(parsePackageJson("{broken"), MINIMUMS).status).toBe("ok");
    expect(checkFrameworkPins(parsePackageJson(null), MINIMUMS).status).toBe("ok");
  });

  it("passes a pinned package the build has no minimum for (forward compat)", () => {
    expect(checkFrameworkPins(pkg({ "@facilis.dev/future": "0.0.1" }), MINIMUMS).status).toBe("ok");
  });

  it("passes non-string specs", () => {
    expect(
      checkFrameworkPins({ dependencies: { "@facilis.dev/core": 123 } }, MINIMUMS).status,
    ).toBe("ok");
  });
});

describe("rewriteFrameworkPins", () => {
  it("raises only the below-minimum exact pins, keeping every other field", () => {
    const source = JSON.stringify(
      {
        name: "facilis-app",
        scripts: { dev: "vite" },
        dependencies: { "@facilis.dev/core": "0.1.9", "@facilis.dev/db": "0.2.0", react: "19.3.0" },
        devDependencies: { "@facilis.dev/auth": "0.1.0", vite: "^8.0.0" },
      },
      null,
      2,
    );
    const next = rewriteFrameworkPins(source, MINIMUMS);
    expect(next).not.toBeNull();
    const parsed = JSON.parse(next as string) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(parsed.dependencies).toEqual({
      "@facilis.dev/core": "0.1.10",
      "@facilis.dev/db": "0.2.0",
      react: "19.3.0",
    });
    expect(parsed.devDependencies).toEqual({ "@facilis.dev/auth": "0.1.10", vite: "^8.0.0" });
    expect(parsed.name).toBe("facilis-app");
    expect(parsed.scripts).toEqual({ dev: "vite" });
    // 2-space formatting with a trailing newline, as the IDE writes package.json elsewhere.
    expect(next).toBe(JSON.stringify(parsed, null, 2) + "\n");
  });

  it("is idempotent: a second pass finds nothing to rewrite", () => {
    const source = JSON.stringify(pkg({ "@facilis.dev/core": "0.1.9" }));
    const once = rewriteFrameworkPins(source, MINIMUMS);
    expect(once).not.toBeNull();
    expect(rewriteFrameworkPins(once as string, MINIMUMS)).toBeNull();
  });

  it("returns null when every pin already satisfies the minimums", () => {
    expect(
      rewriteFrameworkPins(JSON.stringify(pkg({ "@facilis.dev/core": "0.1.10" })), MINIMUMS),
    ).toBeNull();
    expect(rewriteFrameworkPins(JSON.stringify(pkg({ react: "19.3.0" })), MINIMUMS)).toBeNull();
  });

  it("never touches non-exact specs or packages without a minimum", () => {
    const source = JSON.stringify(
      pkg({ "@facilis.dev/core": "file:./vendor/facilis/core", "@facilis.dev/future": "0.0.1" }),
    );
    expect(rewriteFrameworkPins(source, MINIMUMS)).toBeNull();
  });

  it("never adds or removes dependencies", () => {
    const source = JSON.stringify(pkg({ "@facilis.dev/core": "0.1.9" }));
    const next = JSON.parse(rewriteFrameworkPins(source, MINIMUMS) as string) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(next.dependencies)).toEqual(["@facilis.dev/core"]);
  });

  it("returns null on malformed or non-object input", () => {
    expect(rewriteFrameworkPins("{broken", MINIMUMS)).toBeNull();
    expect(rewriteFrameworkPins("[]", MINIMUMS)).toBeNull();
  });
});

describe("publishedFrameworkPin", () => {
  it("returns the package's own compiled version", () => {
    expect(publishedFrameworkPin("@facilis.dev/db", MINIMUMS)).toBe("0.2.0");
  });

  it("throws rather than leak a workspace spec when the table has no entry", () => {
    expect(() => publishedFrameworkPin("@facilis.dev/missing", MINIMUMS)).toThrow(
      /no released version/,
    );
  });
});
