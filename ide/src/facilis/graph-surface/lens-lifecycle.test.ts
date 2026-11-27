// The lens source lifecycle (D-224 §4, #198): activation belongs to the lens, is idempotent, and
// a static source never runs a hook. Synthetic descriptors let the live branch be exercised before
// the first live lens ships.

import { describe, expect, it } from "vitest";
import {
  LENS_AVAILABLE,
  createGraphLensLifecycle,
  type GraphLensSourceAdapter,
} from "./lens-lifecycle.ts";
import type { GraphLensDefinition } from "./lenses.ts";
import { GRAPH_LENSES } from "./lenses-registry.ts";

/** The real registry with security and elevated backed by a live source. */
function liveRegistry(): readonly GraphLensDefinition[] {
  return GRAPH_LENSES.map((definition) =>
    definition.id === "security" || definition.id === "elevated"
      ? { ...definition, source: "live" as const }
      : definition,
  );
}

function recordingAdapter(): { adapter: GraphLensSourceAdapter; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    adapter: {
      source: "live",
      activate: (lens) => calls.push("activate:" + lens),
      deactivate: (lens) => calls.push("deactivate:" + lens),
    },
  };
}

describe("graph lens lifecycle", () => {
  it("runs no hook for a static lens", () => {
    const { adapter, calls } = recordingAdapter();
    const lifecycle = createGraphLensLifecycle([adapter]);
    lifecycle.apply("shared");
    expect(calls).toEqual([]);
    expect(lifecycle.active).toBe("shared");
    lifecycle.dispose();
    expect(calls).toEqual([]);
  });

  it("activates once on open and deactivates on close", () => {
    const { adapter, calls } = recordingAdapter();
    const lifecycle = createGraphLensLifecycle([adapter], liveRegistry());
    lifecycle.apply("security");
    lifecycle.apply("security");
    expect(calls).toEqual(["activate:security"]);
    expect(lifecycle.active).toBe("security");
    lifecycle.dispose();
    expect(calls).toEqual(["activate:security", "deactivate:security"]);
    expect(lifecycle.active).toBeNull();
    lifecycle.dispose();
    expect(calls).toEqual(["activate:security", "deactivate:security"]);
  });

  it("deactivates the old lens before activating the new one on a switch", () => {
    const { adapter, calls } = recordingAdapter();
    const lifecycle = createGraphLensLifecycle([adapter], liveRegistry());
    lifecycle.apply("security");
    lifecycle.apply("elevated");
    expect(calls).toEqual(["activate:security", "deactivate:security", "activate:elevated"]);
  });

  it("reports the adapter's availability and assumes available without one", () => {
    const { adapter } = recordingAdapter();
    const lifecycle = createGraphLensLifecycle(
      [
        {
          ...adapter,
          availability: (lens) =>
            lens === "security"
              ? { available: false, reasonKey: "projectGraph.surface.state.notRunning" }
              : LENS_AVAILABLE,
        },
      ],
      liveRegistry(),
    );
    expect(lifecycle.availabilityOf("security")).toEqual({
      available: false,
      reasonKey: "projectGraph.surface.state.notRunning",
    });
    expect(lifecycle.availabilityOf("elevated")).toEqual(LENS_AVAILABLE);
    // A static lens has no adapter, so it is always available.
    expect(lifecycle.availabilityOf("shared")).toEqual(LENS_AVAILABLE);
  });
});
