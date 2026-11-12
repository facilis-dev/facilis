// graph-focus.ts is module state shared by the AI tools and the open panel, so every case loads
// a fresh copy: a buffered request must not leak from one test into the next.
//
// The repo has no component-test harness, so the canvas wiring is covered by typecheck and lint;
// the request-to-state mapping is tested here to pin the empty-request clearing.

import { describe, expect, it, vi } from "vitest";
import { focusStateFrom } from "@/components/ide/useProjectGraphFocus";
import type { GraphFocusRequest } from "./graph-focus";

type GraphFocusModule = typeof import("./graph-focus");

async function loadFocusModule(): Promise<GraphFocusModule> {
  vi.resetModules();
  return await import("./graph-focus");
}

function request(nodes: string[], edges: string[], zoom = true): GraphFocusRequest {
  return { nodes, edges, zoom };
}

describe("graph focus requests", () => {
  it("notifies every subscriber with the request", async () => {
    const { notifyGraphFocus, subscribeGraphFocus } = await loadFocusModule();
    const first = vi.fn();
    const second = vi.fn();
    subscribeGraphFocus(first);
    subscribeGraphFocus(second);
    const focus = request(["page-a"], ["edge-1"]);
    notifyGraphFocus(focus);
    expect(first).toHaveBeenCalledWith(focus);
    expect(second).toHaveBeenCalledWith(focus);
  });

  it("replays a pending request once to the next subscriber, then clears it", async () => {
    const { notifyGraphFocus, subscribeGraphFocus } = await loadFocusModule();
    // The graph tab was closed when the tool asked, so the request waits for the next mount.
    notifyGraphFocus(request(["page-a"], []));
    const first = vi.fn();
    subscribeGraphFocus(first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ nodes: ["page-a"], edges: [], zoom: true });
    const second = vi.fn();
    subscribeGraphFocus(second);
    expect(second).not.toHaveBeenCalled();
  });

  it("replays only the newest buffered request", async () => {
    const { notifyGraphFocus, subscribeGraphFocus } = await loadFocusModule();
    notifyGraphFocus(request(["page-a"], []));
    notifyGraphFocus(request(["table-b"], ["edge-2"], false));
    const listener = vi.fn();
    subscribeGraphFocus(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ nodes: ["table-b"], edges: ["edge-2"], zoom: false });
  });

  it("stops delivering after unsubscribe", async () => {
    const { notifyGraphFocus, subscribeGraphFocus } = await loadFocusModule();
    const listener = vi.fn();
    const unsubscribe = subscribeGraphFocus(listener);
    unsubscribe();
    notifyGraphFocus(request(["page-a"], []));
    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers an empty request unchanged: clearing is the panel's decision", async () => {
    const { notifyGraphFocus, subscribeGraphFocus } = await loadFocusModule();
    const listener = vi.fn();
    subscribeGraphFocus(listener);
    const clear = request([], [], false);
    notifyGraphFocus(clear);
    expect(listener).toHaveBeenCalledWith(clear);
  });
});

describe("focusStateFrom", () => {
  it("clears the focus when both id lists are empty", () => {
    expect(focusStateFrom(request([], [], true))).toBeNull();
    expect(focusStateFrom(request([], [], false))).toBeNull();
  });

  it("keeps the ids as sets and carries the zoom flag", () => {
    const state = focusStateFrom(request(["page-a", "table-b"], ["edge-1"], false));
    expect(state).not.toBeNull();
    expect(state?.zoom).toBe(false);
    expect([...(state?.nodeIds ?? [])]).toEqual(["page-a", "table-b"]);
    expect([...(state?.edgeIds ?? [])]).toEqual(["edge-1"]);
  });
});
