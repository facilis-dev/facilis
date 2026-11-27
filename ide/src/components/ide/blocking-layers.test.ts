// The layer stack's guarantees (issue #212): one surface can say it covers the workspace,
// the last one down reopens it, and subscribers hear transitions only. Pure, so it runs in
// Vitest without a DOM; the hook is a thin read over the same store.
import { describe, expect, it, vi } from "vitest";
import { createBlockingLayers } from "./blocking-layers";

describe("createBlockingLayers", () => {
  it("is open only while at least one layer is registered", () => {
    const layers = createBlockingLayers();
    expect(layers.isOpen()).toBe(false);
    const unregisterHome = layers.register("home");
    expect(layers.isOpen()).toBe(true);
    const unregisterTour = layers.register("tour");
    unregisterHome();
    // The tour is still covering the workspace: closing Home must not reopen it.
    expect(layers.isOpen()).toBe(true);
    unregisterTour();
    expect(layers.isOpen()).toBe(false);
  });

  it("is idempotent: a double register and a double unregister are one transition each", () => {
    const layers = createBlockingLayers();
    const listener = vi.fn();
    const unsubscribe = layers.subscribe(listener);
    const off = layers.register("home");
    layers.register("home");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    off();
    layers.unregister("home");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const layers = createBlockingLayers();
    const listener = vi.fn();
    layers.subscribe(listener)();
    layers.register("home");
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify before the first real transition", () => {
    const layers = createBlockingLayers();
    const listener = vi.fn();
    layers.subscribe(listener);
    layers.unregister("never-registered");
    expect(listener).not.toHaveBeenCalled();
  });
});
