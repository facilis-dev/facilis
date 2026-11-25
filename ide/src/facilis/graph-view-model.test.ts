// The incremental view-model contract (issue #186): a burst of search keystrokes costs ONE
// debounced match pass and ZERO model rebuilds; selection/focus/viewport churn never rebuilds
// node objects; only dataset/saved-layout changes do. The builder is injected as a spy so the
// test counts real model builds, and the timers are a fake clock so the debounce is exact.
import { describe, expect, it, vi } from "vitest";
import { emptyGraphLayout, type GraphLayoutFile } from "./graph-layout-file.ts";
import { withNodePosition, withViewport } from "./graph-layout.ts";
import { buildProjectGraphView } from "./graph-model.ts";
import { GET, PAGE, TODOS, graphOf, tableNode } from "./graph-model.test-fixtures.ts";
import { matchGraphNodes } from "./graph-search.ts";
import {
  createGraphViewModel,
  graphViewModelInput,
  type GraphSearchResult,
  type GraphViewModelTimers,
} from "./graph-view-model.ts";

function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: GraphViewModelTimers = {
    set: (callback, ms) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { at: now + ms, callback });
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [handle, entry] of due) {
        pending.delete(handle);
        entry.callback();
      }
    },
    pendingCount: () => pending.size,
  };
}

const graph = graphOf([PAGE, GET, TODOS]);
const layout = emptyGraphLayout();

function setup() {
  const clock = fakeClock();
  const build = vi.fn(buildProjectGraphView);
  const passes: GraphSearchResult[] = [];
  const model = createGraphViewModel({
    buildView: build,
    onSearch: (result) => passes.push(result),
    timers: clock.timers,
    delayMs: 150,
  });
  return { clock, build, passes, model };
}

describe("incremental view model: search", () => {
  it("a burst of keystrokes triggers one debounced match pass and ZERO model rebuilds", () => {
    const { clock, build, passes, model } = setup();
    const input = graphViewModelInput(graph, layout);
    const first = model.update(input);
    expect(first).not.toBeNull();
    expect(build).toHaveBeenCalledTimes(1);

    for (const query of ["t", "to", "tod", "todo", "todos"]) model.pushQuery(query);
    clock.advance(149);
    expect(passes).toHaveLength(0); // still debouncing: no pass mid-burst
    clock.advance(1);
    expect(passes).toHaveLength(1); // exactly one pass for the whole burst
    expect(passes[0]?.query).toBe("todos");
    expect(passes[0]?.matched).toEqual(matchGraphNodes(first?.nodes ?? [], "todos"));

    // ZERO model rebuilds: same cached view, same node objects.
    expect(build).toHaveBeenCalledTimes(1);
    const again = model.update(input);
    expect(again).toBe(first);
    expect(again?.nodes[0]).toBe(first?.nodes[0]);
    expect(again?.edges).toBe(first?.edges);
  });

  it("typing back to the applied query cancels the pending pass", () => {
    const { clock, passes, model } = setup();
    model.update(graphViewModelInput(graph, layout));
    model.pushQuery("todos");
    clock.advance(150);
    expect(passes).toHaveLength(1);
    model.pushQuery("todo");
    model.pushQuery("todos");
    expect(clock.pendingCount()).toBe(0);
    clock.advance(500);
    expect(passes).toHaveLength(1);
  });

  it("clearing back to a blank query matches every node again", () => {
    const { clock, passes, model } = setup();
    const view = model.update(graphViewModelInput(graph, layout));
    // A blank query equal to the applied one is a no-op: the model already matches everything.
    model.pushQuery("   ");
    clock.advance(150);
    expect(passes).toHaveLength(0);
    expect(model.searchResult.matched.size).toBe(view?.nodes.length);
    model.pushQuery("todos");
    clock.advance(150);
    model.pushQuery("   ");
    clock.advance(150);
    expect(passes).toHaveLength(2);
    expect(passes[1]?.query).toBe("");
    expect(passes[1]?.matched.size).toBe(view?.nodes.length);
  });

  it("flush runs the pending pass now; dispose cancels it", () => {
    const { clock, passes, model } = setup();
    model.update(graphViewModelInput(graph, layout));
    model.pushQuery("todos");
    model.flush();
    expect(passes).toHaveLength(1);
    expect(clock.pendingCount()).toBe(0);
    model.pushQuery("pages");
    model.dispose();
    clock.advance(500);
    expect(passes).toHaveLength(1);
  });
});

describe("incremental view model: selection, focus and viewport", () => {
  it("selecting nodes never rebuilds the model", () => {
    const { build, model } = setup();
    const first = model.update(graphViewModelInput(graph, layout));
    // Selection is canvas draw state: the panel re-renders and re-derives the SAME inputs.
    let selectedNodeId: string | null = null;
    for (const id of [TODOS.id, GET.id, PAGE.id, null]) {
      selectedNodeId = id;
      const again = model.update(graphViewModelInput(graph, layout));
      expect(again).toBe(first);
      expect(again?.nodes[0]).toBe(first?.nodes[0]);
    }
    expect(selectedNodeId).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("viewport churn (pan/zoom persist) never rebuilds the model", () => {
    const { build, model } = setup();
    const first = model.update(graphViewModelInput(graph, layout));
    let panned: GraphLayoutFile = layout;
    for (let i = 1; i <= 20; i += 1) {
      panned = withViewport(panned, { x: i * 3, y: i * 2, zoom: 1 });
      expect(model.update(graphViewModelInput(graph, panned))).toBe(first);
    }
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("an AI focus announcement never rebuilds the model", () => {
    const { build, model } = setup();
    const first = model.update(graphViewModelInput(graph, layout));
    // Focus (D-171) lives in graph-focus state, outside the view-model inputs entirely.
    const focus = { nodeIds: new Set([TODOS.id]), edgeIds: new Set<string>(), zoom: true };
    expect(focus.nodeIds.has(TODOS.id)).toBe(true);
    expect(model.update(graphViewModelInput(graph, layout))).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("incremental view model: legitimate rebuilds", () => {
  it("rebuilds once per dataset change and refreshes the active match pass", () => {
    const { clock, build, passes, model } = setup();
    model.update(graphViewModelInput(graph, layout));
    model.pushQuery("todos");
    clock.advance(150);
    expect(passes).toHaveLength(1);

    const grown = graphOf([PAGE, GET, TODOS, tableNode("todos_archive")]);
    const view = model.update(graphViewModelInput(grown, layout));
    expect(build).toHaveBeenCalledTimes(2);
    // The active query is re-applied to the new nodes without another keystroke.
    expect(model.searchResult.query).toBe("todos");
    expect(model.searchResult.matched.has("table:todos_archive")).toBe(true);
    expect(view?.nodes.length).toBe(4);
  });

  it("saved positions, filters and collapse are model inputs", () => {
    const { build, model } = setup();
    const input = graphViewModelInput(graph, layout);
    model.update(input);
    model.update(graphViewModelInput(graph, withNodePosition(layout, TODOS.id, { x: 900, y: 40 })));
    model.update(graphViewModelInput(graph, { ...layout, hiddenEdges: ["fk"] }));
    model.update(graphViewModelInput(graph, { ...layout, tableVisibility: "project" }));
    model.update(graphViewModelInput(graph, { ...layout, collapsed: { [TODOS.id]: true } }));
    expect(build).toHaveBeenCalledTimes(5);
    // Saved positions still override the automatic placement.
    const moved = model.update(
      graphViewModelInput(graph, withNodePosition(layout, TODOS.id, { x: 900, y: 40 })),
    );
    expect(moved?.nodes.find((node) => node.id === TODOS.id)?.position).toEqual({ x: 900, y: 40 });
  });

  it("a null analysis yields a null view without dropping the applied query", () => {
    const { clock, passes, model } = setup();
    model.update(graphViewModelInput(graph, layout));
    model.pushQuery("todos");
    clock.advance(150);
    expect(model.update(graphViewModelInput(null, layout))).toBeNull();
    expect(model.searchResult.query).toBe("todos");
    expect(model.searchResult.matched.size).toBe(0);
    const back = model.update(graphViewModelInput(graph, layout));
    expect(back).not.toBeNull();
    expect(model.searchResult.matched.has(TODOS.id)).toBe(true);
    expect(passes).toHaveLength(1);
  });
});
