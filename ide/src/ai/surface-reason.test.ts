import { describe, expect, it } from "vitest";

import type { FilePatch, SurfaceRequest } from "@facilis.dev/ai";

import { applySurfaceReasons, surfaceRequestKey } from "./surface-reason";

function request(overrides: Partial<SurfaceRequest> = {}): SurfaceRequest {
  return {
    path: "server/routes/hook.post.ts",
    capability: "raw-route",
    reason: "signed webhook endpoint",
    snippet: "export default defineRawRoute({",
    line: 4,
    ...overrides,
  };
}

function patch(content: string, path = "server/routes/hook.post.ts"): FilePatch {
  return { path, action: "create", content };
}

const ROUTE = `import { defineRawRoute } from "@facilis.dev/core";

// signed webhook endpoint
export default defineRawRoute({
  reason: "signed webhook endpoint",
  auth: "none",
});
`;

describe("surfaceRequestKey", () => {
  it("is stable per declaration site", () => {
    expect(surfaceRequestKey(request())).toBe("server/routes/hook.post.ts:4:raw-route");
  });
});

describe("applySurfaceReasons", () => {
  it("rewrites exactly the edited reason", () => {
    const edited = { [surfaceRequestKey(request())]: "receives signed Stripe webhooks" };
    const result = applySurfaceReasons(patch(ROUTE), [request()], edited);
    expect(result.content).toContain('reason: "receives signed Stripe webhooks",');
    expect(result.content).not.toContain('reason: "signed webhook endpoint"');
    // Everything else is the model's exact text: no re-serialization.
    expect(
      result.content?.replace('"receives signed Stripe webhooks"', '"signed webhook endpoint"'),
    ).toBe(ROUTE);
  });

  it("escapes the edited reason, so the written literal stays valid", () => {
    const reason = 'he said "hi"';
    const edited = { [surfaceRequestKey(request())]: reason };
    const result = applySurfaceReasons(patch(ROUTE), [request()], edited);
    const row = (result.content ?? "").split("\n").find((line) => line.includes("reason:"));
    expect(row).toBe('  reason: "he said \\"hi\\"",');
    const literal = (row ?? "").trim().slice("reason: ".length).replace(/,$/, "");
    expect(JSON.parse(literal)).toBe(reason);
  });

  it("leaves an ambiguous site alone instead of guessing", () => {
    const ambiguous = patch(
      `const a = { reason: "duplicate" };
const b = { reason: "duplicate" };
`,
    );
    const duplicated = request({
      path: "server/routes/hook.post.ts",
      capability: "raw-sql",
      reason: "duplicate",
      line: 9,
    });
    const result = applySurfaceReasons(ambiguous, [duplicated], {
      [surfaceRequestKey(duplicated)]: "edited",
    });
    expect(result).toBe(ambiguous);
  });

  it("still rewrites the only matching site when the reported line is stale", () => {
    const stale = request({ line: 9 });
    const result = applySurfaceReasons(patch(ROUTE), [stale], {
      [surfaceRequestKey(stale)]: "unique reason",
    });
    expect(result.content).toContain('reason: "unique reason",');
  });

  it("ignores an empty edit and an unchanged reason", () => {
    const blank = { [surfaceRequestKey(request())]: "   " };
    const original = patch(ROUTE);
    expect(applySurfaceReasons(original, [request()], blank)).toBe(original);
    expect(
      applySurfaceReasons(original, [request()], {
        [surfaceRequestKey(request())]: "signed webhook endpoint",
      }),
    ).toBe(original);
  });

  it("ignores requests for another file and deletes", () => {
    const other = patch(ROUTE);
    const elsewhere = request({ path: "server/routes/other.get.ts" });
    expect(
      applySurfaceReasons(other, [elsewhere], { [surfaceRequestKey(elsewhere)]: "edited" }),
    ).toBe(other);
    const removed: FilePatch = { path: "server/routes/hook.post.ts", action: "delete" };
    expect(applySurfaceReasons(removed, [request()], { [surfaceRequestKey(request())]: "x" })).toBe(
      removed,
    );
  });

  it("rewrites a dynamic-code marker without touching the code", () => {
    const source = patch(`// dynamic-code: evaluates a user formula
export function run(formula: string) {
  return eval(formula);
}
`);
    const dynamic = request({
      capability: "dynamic-code",
      reason: "evaluates a user formula",
      line: 1,
      snippet: "// dynamic-code: evaluates a user formula",
    });
    const result = applySurfaceReasons(source, [dynamic], {
      [surfaceRequestKey(dynamic)]: "runs a sandboxed user formula",
    });
    expect(result.content).toBe(`// dynamic-code: runs a sandboxed user formula
export function run(formula: string) {
  return eval(formula);
}
`);
  });
});
