// The confirmed-write half of the pause (D-193/D-226): a destructive schema write must not
// smuggle an unconfirmed declaration into the project, so the revalidation is inspected before
// anything is applied.

import { describe, expect, it } from "vitest";

import type { Analysis, FilePatch } from "@facilis.dev/ai";

import { overlayPatches } from "@/facilis/patch-analysis";
import { analyzeSources } from "./analysis-fixtures";
import { applyConfirmedWrite } from "./chat-write-confirm";
import type { ChatWritesHost } from "./chat-write-types";

const PATH = "db/schema.ts";

/** A declared dynamic-code site: the analyzer reports one declaration at line 1. */
const DECLARING = `// dynamic-code: fixture formula engine
export const run = (formula: string) => eval(formula);
`;

const PACKAGE = JSON.stringify({ dependencies: { "drizzle-orm": "^0.44.0" } }, null, 2) + "\n";

interface Harness {
  applied: FilePatch[];
  deps: Parameters<typeof applyConfirmedWrite>[0];
}

function harness(): Harness {
  const sources = new Map([
    [PATH, "export const untouched = true;\n"],
    ["package.json", PACKAGE],
  ]);
  const applied: FilePatch[] = [];
  const host: ChatWritesHost = {
    root: () => "/projects/app",
    bridge: { request: async () => ({ ok: true }) },
    manifestBase: () => null,
    files: () => [...sources.keys()],
    read: async (path) => sources.get(path) ?? "",
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: async (
      patches,
      _signal,
      overlay = [],
    ): Promise<{ before: Analysis; after: Analysis }> => {
      const base = overlayPatches(sources, overlay);
      return { before: analyzeSources(base), after: analyzeSources(overlayPatches(base, patches)) };
    },
    safety: {
      gate: async () => ({ ok: true, head: "0123456789abcdef" }),
      commitAll: async () => ({ ok: true }),
      init: async () => ({ ok: true }),
      restore: async () => ({ ok: true, errors: [] }),
    },
  };
  const deps = {
    host,
    overlay: () => [] as readonly FilePatch[],
    persist: {
      bridge: host.bridge,
      apply: async (input: { patches: readonly FilePatch[] }) => {
        applied.push(...input.patches);
        return {
          ok: true,
          validation: { ok: true, errors: [], warnings: [] },
          written: input.patches.map((patch) => patch.path),
          deleted: [],
          revision: null,
          errors: [],
        };
      },
      before: async () => null,
      manifestBase: () => null,
      record: () => {},
    },
    markOutage: () => {},
  } satisfies Parameters<typeof applyConfirmedWrite>[0];
  return { applied, deps };
}

describe("applyConfirmedWrite", () => {
  it("refuses to write a declaration the user has not confirmed", async () => {
    const h = harness();
    const outcome = await applyConfirmedWrite(h.deps, {
      patch: { path: PATH, action: "update", content: DECLARING },
    });
    expect(outcome.ok).toBe(false);
    expect("errors" in outcome && outcome.errors).toContainEqual(
      expect.objectContaining({ rule: "surface-confirmation" }),
    );
    expect(h.applied).toHaveLength(0);
  });

  it("writes it once the surface confirmation is recorded", async () => {
    const h = harness();
    const outcome = await applyConfirmedWrite(h.deps, {
      patch: { path: PATH, action: "update", content: DECLARING },
      confirmedSurface: true,
    });
    expect(outcome).toMatchObject({ ok: true, path: PATH });
    expect(h.applied).toEqual([{ path: PATH, action: "update", content: DECLARING }]);
  });
});
