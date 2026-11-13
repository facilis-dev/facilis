import { describe, expect, it } from "vitest";

import type { DependencyAccess, DependencyListing, DependencyRefusal } from "../dependency-access";
import { createDependencyToolHandlers } from "./dependency-tools";
import { isPtcToolError, type PtcJson } from "./protocol";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<PtcJson>;

function fakeAccess(result: DependencyListing | DependencyRefusal): {
  access: DependencyAccess;
  calls: (string | undefined)[];
} {
  const calls: (string | undefined)[] = [];
  const access: DependencyAccess = {
    async list(input) {
      calls.push(input?.package);
      return result;
    },
  };
  return { access, calls };
}

/** The one handler this family registers; fails loudly if the family is absent. */
function handler(access: DependencyAccess | undefined): Handler {
  const handlers = createDependencyToolHandlers(
    access === undefined ? {} : { dependencies: access },
  );
  const call = handlers["list_dependencies"];
  if (call === undefined) throw new Error("list_dependencies is not registered");
  return call;
}

async function refusal(value: unknown): Promise<Error> {
  try {
    await value;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

const PACKAGES: DependencyListing = {
  kind: "packages",
  packages: ["react", "zod"],
  truncated: false,
};

const FILES: DependencyListing = {
  kind: "files",
  package: "react",
  files: ["node_modules/react/index.js"],
  truncated: true,
};

describe("dependency tool registration", () => {
  it("registers no handler when the host has no dependency seam", () => {
    expect(createDependencyToolHandlers({})).toEqual({});
  });

  it("registers list_dependencies when the seam exists", () => {
    const { access } = fakeAccess(PACKAGES);
    expect(Object.keys(createDependencyToolHandlers({ dependencies: access }))).toEqual([
      "list_dependencies",
    ]);
  });
});

describe("list_dependencies", () => {
  it("returns the package list for no arguments", async () => {
    const { access, calls } = fakeAccess(PACKAGES);
    expect(await handler(access)({})).toEqual(PACKAGES);
    expect(calls).toEqual([undefined]);
  });

  it("returns one package's files when a package is given", async () => {
    const { access, calls } = fakeAccess(FILES);
    expect(await handler(access)({ package: "react" })).toEqual(FILES);
    expect(calls).toEqual(["react"]);
  });

  it("returns plain JSON, not a live seam object", async () => {
    const { access } = fakeAccess(FILES);
    const result = await handler(access)({ package: "react" });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("refuses malformed arguments with a capability error", async () => {
    const { access, calls } = fakeAccess(PACKAGES);
    const call = handler(access);
    for (const args of [
      [],
      null,
      "react",
      { package: 42 },
      { package: null },
      { package: "" },
      { package: "x".repeat(215) },
    ]) {
      const error = await refusal(call(args as unknown as Args));
      expect(isPtcToolError(error), JSON.stringify(args)).toBe(true);
      if (isPtcToolError(error)) expect(error.kind).toBe("capability");
    }
    expect(calls).toEqual([]);
  });

  it("turns an unsafe package-name refusal from the seam into a capability error", async () => {
    const { access } = fakeAccess({
      kind: "refused",
      reason: "invalid_package_name",
      package: "../evil",
    });
    const error = await refusal(handler(access)({ package: "../evil" }));
    expect(isPtcToolError(error)).toBe(true);
    if (isPtcToolError(error)) {
      expect(error.kind).toBe("capability");
      expect(error.message).toContain("@scope/name");
    }
  });
});
