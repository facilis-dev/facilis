// The palette/picker catalogue (issue #204): one entry per registry lens in registry order, an
// injected definition proves no lens is hardcoded, and the runtime lens carries its translated
// unavailability. The chord itself moved to the shortcut registry (shortcuts.test.ts, #223).

import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import type { GraphLensId } from "@/facilis/graph-surface/lenses.ts";
import { GRAPH_LENSES } from "@/facilis/graph-surface/lenses-registry.ts";
import {
  requestGraphLens,
  subscribeGraphLensRequests,
} from "@/facilis/graph-surface/lens-request.ts";
import {
  graphLensCommands,
  LENS_PICKER_CHORD,
  type GraphLensCommandController,
} from "./graph-lens-commands";

function fakeController(): GraphLensCommandController & { opened: number } {
  const controller = {
    opened: 0,
    bridge: {},
    preview: { activePreviewTab: () => null },
    openProjectGraph() {
      controller.opened += 1;
    },
  };
  return controller as unknown as GraphLensCommandController & { opened: number };
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("graph lens commands", () => {
  it("derives one command per registry lens, in order, with its picker sequence", () => {
    const commands = graphLensCommands(fakeController(), false);
    expect(commands).toHaveLength(GRAPH_LENSES.length);
    expect(commands.map((command) => command.lens)).toEqual(GRAPH_LENSES.map((lens) => lens.id));
    expect(commands[0].label).toBe("Lens: Q5 · Security");
    expect(commands[0].keys).toBe(LENS_PICKER_CHORD + " 1");
    expect(commands.at(-1)?.title).toBe("Q21 · Prerender");
  });

  it("follows an injected registry entry instead of a hardcoded lens list", () => {
    const fake = {
      ...GRAPH_LENSES[0],
      id: "fake" as GraphLensId,
      titleKey: "projectGraph.surface.lens.reach" as const,
    };
    const commands = graphLensCommands(fakeController(), false, [fake]);
    expect(commands).toHaveLength(1);
    expect(commands[0].title).toBe("Q20 · Reach");
    expect(commands[0].keys).toBe(LENS_PICKER_CHORD + " 1");
  });

  it("reports the runtime lens unavailable outside a dev build", () => {
    const commands = graphLensCommands(fakeController(), false);
    const runtime = commands.find((command) => command.lens === "runtime");
    expect(runtime?.disabled).toBe(true);
    expect(runtime?.reason).toBe("Runtime samples exist only in a dev build.");
    const changes = commands.find((command) => command.lens === "changes");
    expect(changes?.disabled).toBe(false);
  });

  it("opens the graph and asks the panel for the lens through the shared request", () => {
    const controller = fakeController();
    const seen: GraphLensId[] = [];
    const off = subscribeGraphLensRequests((lens) => seen.push(lens));
    graphLensCommands(controller, false)[0].run();
    off();
    expect(controller.opened).toBe(1);
    expect(seen).toEqual(["security"]);
  });
});

describe("lens request store", () => {
  it("replays a request made before the panel mounted exactly once", () => {
    requestGraphLens("changes");
    const seen: GraphLensId[] = [];
    const off = subscribeGraphLensRequests((lens) => seen.push(lens));
    off();
    expect(seen).toEqual(["changes"]);
    const second: GraphLensId[] = [];
    subscribeGraphLensRequests((lens) => second.push(lens))();
    expect(second).toEqual([]);
  });
});
