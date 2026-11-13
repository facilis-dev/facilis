import { describe, expect, it } from "vitest";

import {
  createFrameworkAccess,
  type FrameworkAccess,
  type FrameworkEntry,
  type FrameworkReferenceResult,
} from "../framework-reference";
import { isPtcToolError } from "./protocol";
import { createFrameworkToolHandlers } from "./framework-tools";

function handlerFor(framework?: FrameworkAccess) {
  const handlers = createFrameworkToolHandlers(framework === undefined ? {} : { framework });
  const handler = handlers["framework_reference"];
  if (handler === undefined) throw new Error("framework_reference handler missing");
  return handler;
}

function realHandler() {
  return handlerFor(createFrameworkAccess());
}

/** The tool contract takes a JSON object; the test passes deliberately bad values through. */
function asArgs(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool to refuse the call");
}

/** A seam with n large entries: enough to prove the byte cap, not just the entry cap. */
function largeAccess(count: number): FrameworkAccess {
  const entry: FrameworkEntry = {
    name: "largeEntry",
    kind: "function",
    signature: "largeEntry(value: string): string",
    summary: "x".repeat(400),
  };
  const reference = (): FrameworkReferenceResult => ({
    matches: Array.from({ length: count }, (_, index) => ({
      ...entry,
      name: "largeEntry" + index,
      module: "fake",
      package: "@facilis.dev/fake",
    })),
    truncated: false,
  });
  return { reference };
}

describe("createFrameworkToolHandlers", () => {
  it("is empty when the host has no reference seam", () => {
    expect(createFrameworkToolHandlers({})).toEqual({});
  });

  it("advertises only framework_reference", () => {
    expect(
      Object.keys(createFrameworkToolHandlers({ framework: createFrameworkAccess() })),
    ).toEqual(["framework_reference"]);
  });
});

describe("framework_reference", () => {
  it("filters by module", async () => {
    const result = (await realHandler()({ module: "time" })) as {
      matches: { module: string }[];
      truncated: boolean;
    };
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((match) => match.module === "time")).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("filters by query and accepts the package spelling", async () => {
    const byQuery = (await realHandler()({ query: "signDownloadToken" })) as {
      matches: { name: string; package: string }[];
    };
    expect(byQuery.matches.map((match) => match.name)).toContain("signDownloadToken");

    const byPackage = (await realHandler()({ module: "@facilis.dev/storage" })) as {
      matches: { package: string }[];
    };
    expect(byPackage.matches.every((match) => match.package === "@facilis.dev/storage")).toBe(true);
  });

  it("returns an unknown module as empty data", async () => {
    expect(await realHandler()({ module: "nope" })).toEqual({ matches: [], truncated: false });
  });

  it("caps a broad lookup and reports truncation", async () => {
    const result = (await realHandler()({})) as {
      matches: unknown[];
      truncated: boolean;
    };
    // The 8 KB budget can bite before the 40-entry cap: either way the answer is bounded.
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeLessThan(40);
    expect(result.truncated).toBe(true);
  });

  it("caps the serialized response at 8 KB even when entries are large", async () => {
    const result = await handlerFor(largeAccess(60))({});
    const text = JSON.stringify(result);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(8 * 1024);
    expect((result as { truncated: boolean }).truncated).toBe(true);
  });

  it("refuses malformed arguments", async () => {
    const handler = realHandler();
    expect((await refusal(handler(asArgs(null)))).message).toContain("JSON object");
    expect((await refusal(handler(asArgs([])))).message).toContain("JSON object");
    expect((await refusal(handler({ module: 7 }))).message).toContain("module must be");
    expect((await refusal(handler({ query: 7 }))).message).toContain("query must be");
    expect((await refusal(handler({ query: "x".repeat(201) }))).message).toContain("query must be");
    expect(isPtcToolError(await refusal(handler({ module: null })))).toBe(true);
  });

  it("treats empty filters as absent and ignores unknown fields", async () => {
    const result = (await realHandler()({ module: "", query: "", extra: true })) as {
      matches: unknown[];
      truncated: boolean;
    };
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });
});
