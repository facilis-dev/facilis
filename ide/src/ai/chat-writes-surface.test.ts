import { describe, expect, it, vi } from "vitest";

import type { Analysis, FilePatch } from "@facilis.dev/ai";
import { overlayPatches } from "@/facilis/patch-analysis";
import type { ApplyPatchInput, ApplyPatchResult } from "@/facilis/apply-patch";
import { analyzeSources } from "./analysis-fixtures";
import {
  createChatWrites,
  type ChatWrites,
  type ChatWritesHost,
  type WriteOutcome,
  type WriteSurfaceConfirmation,
} from "./chat-writes";
import { surfaceRequestKey } from "./surface-reason";
import type { GitGate, GitSafety } from "./types";

// The engine must revalidate a confirmed declaration WITHOUT asking again: the flag is the
// only observable difference, so the seam records what each validation was told (D-226).
const validations = vi.hoisted(
  () => [] as { requiresConfirmation?: boolean; confirmedSurface?: boolean }[],
);

vi.mock("./patch-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./patch-validation")>();
  return {
    ...actual,
    async validatePatchesWithHost(
      patches: readonly FilePatch[],
      host: Parameters<typeof actual.validatePatchesWithHost>[1],
      options: Parameters<typeof actual.validatePatchesWithHost>[2] = {},
    ) {
      validations.push({
        requiresConfirmation: options.requiresConfirmation,
        confirmedSurface: options.confirmedSurface,
      });
      return actual.validatePatchesWithHost(patches, host, options);
    },
  };
});

const ROUTE_PATH = "server/routes/hook.post.ts";

/** A declared raw route: the analyzer reports one raw-route declaration at line 4. */
const ROUTE = `import { defineRawRoute } from "@facilis.dev/core";

// signed webhook endpoint
export default defineRawRoute(
  {
    reason: "signed webhook endpoint",
    auth: "none",
    dbTables: [],
  },
  async () => new Response("ok"),
);
`;

const PACKAGE = JSON.stringify({ dependencies: { "@facilis.dev/core": "^2.0.0" } }, null, 2) + "\n";
const CLEAN_GATE: GitGate = { ok: true, head: "0123456789abcdef" };

interface Harness {
  writes: ChatWrites;
  applyCalls: ApplyPatchInput[];
}

function harness(): Harness {
  const sources = new Map([["package.json", PACKAGE]]);
  const applyCalls: ApplyPatchInput[] = [];
  const safety: GitSafety = {
    gate: async () => CLEAN_GATE,
    commitAll: async () => ({ ok: true }),
    init: async () => ({ ok: true }),
    restore: async () => ({ ok: true, errors: [] }),
  };
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
    safety,
  };
  const writes = createChatWrites(host, {
    apply: async (input): Promise<ApplyPatchResult> => {
      applyCalls.push(input);
      const written = input.patches.filter((patch) => patch.action !== "delete").map((p) => p.path);
      return {
        ok: true,
        validation: { ok: true, errors: [], warnings: [] },
        written,
        deleted: [],
        revision: null,
        errors: [],
      };
    },
  });
  return { writes, applyCalls };
}

function surfaceOf(outcome: WriteOutcome): WriteSurfaceConfirmation["surface"] | null {
  return !outcome.ok && "surface" in outcome ? outcome.surface : null;
}

describe("createChatWrites surface confirmation", () => {
  it("pauses on a declaration and writes nothing", async () => {
    const h = harness();
    const outcome = await h.writes.writeFile(ROUTE_PATH, ROUTE);
    expect(outcome.ok).toBe(false);
    expect(surfaceOf(outcome)?.requests).toHaveLength(1);
    expect(h.applyCalls).toHaveLength(0);
    expect(h.writes.turnWrites()).toHaveLength(0);
    const pending = h.writes.takeSurfaceConfirmation();
    expect(pending?.requests[0]).toMatchObject({
      path: ROUTE_PATH,
      capability: "raw-route",
      reason: "signed webhook endpoint",
      line: 4,
    });
    expect(pending?.requests[0]?.snippet).toContain("defineRawRoute");
    expect(validations[0]?.confirmedSurface).toBeUndefined();
  });

  it("applies the held write once confirmed and revalidates as confirmed", async () => {
    const h = harness();
    await h.writes.writeFile(ROUTE_PATH, ROUTE);
    const applied = await h.writes.applyPendingSurface();
    expect(applied).toMatchObject({ ok: true, path: ROUTE_PATH, action: "create" });
    expect(h.applyCalls).toHaveLength(1);
    expect(h.applyCalls[0]?.patches[0]?.content).toBe(ROUTE);
    expect(validations.at(-1)).toEqual({ requiresConfirmation: true, confirmedSurface: true });
    expect(h.writes.takeSurfaceConfirmation()).toBeNull();
    expect(h.writes.turnWrites()).toEqual([expect.objectContaining({ path: ROUTE_PATH })]);
  });

  it("writes the reason the user edited", async () => {
    const h = harness();
    await h.writes.writeFile(ROUTE_PATH, ROUTE);
    const request = h.writes.takeSurfaceConfirmation()?.requests[0];
    if (request === undefined) throw new Error("the write must pause on the declaration");
    await h.writes.applyPendingSurface({
      [surfaceRequestKey(request)]: "verifies the Stripe signature",
    });
    expect(h.applyCalls[0]?.patches[0]?.content).toContain(
      'reason: "verifies the Stripe signature",',
    );
    expect(validations.at(-1)?.confirmedSurface).toBe(true);
  });

  it("drops the pending write on cancel, leaving the disk untouched", async () => {
    const h = harness();
    await h.writes.writeFile(ROUTE_PATH, ROUTE);
    h.writes.discardPendingSurface();
    expect(h.writes.takeSurfaceConfirmation()).toBeNull();
    expect(h.applyCalls).toHaveLength(0);
    expect(h.writes.turnWrites()).toHaveLength(0);
    // The turn continues: the next, standard write is not blocked by the dropped one.
    expect(await h.writes.writeFile("src/util.ts", "export const value = 1;\n")).toMatchObject({
      ok: true,
      path: "src/util.ts",
    });
  });

  it("refuses every other write while the declaration is pending", async () => {
    const h = harness();
    await h.writes.writeFile(ROUTE_PATH, ROUTE);
    const other = await h.writes.writeFile("src/other.ts", "export const other = 1;\n");
    expect(other.ok).toBe(false);
    expect(surfaceOf(other)?.requests).toHaveLength(1);
    expect(h.applyCalls).toHaveLength(0);
  });

  it("reports nothing to apply when the pending write was already resolved", async () => {
    const h = harness();
    await h.writes.writeFile(ROUTE_PATH, ROUTE);
    await h.writes.applyPendingSurface();
    const again = await h.writes.applyPendingSurface();
    expect(again.ok).toBe(false);
    expect("errors" in again && again.errors.length > 0).toBe(true);
    expect(h.applyCalls).toHaveLength(1);
  });

  it("forgets the pending write when the turn restarts", async () => {
    const h = harness();
    await h.writes.writeFile(ROUTE_PATH, ROUTE);
    h.writes.beginTurn();
    expect(h.writes.takeSurfaceConfirmation()).toBeNull();
  });
});
