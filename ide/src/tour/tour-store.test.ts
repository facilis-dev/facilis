import { describe, expect, it } from "vitest";
import { tourStepsFor } from "./tour-steps";
import {
  TOUR_STORAGE_KEY,
  TOUR_VERSION,
  createTourStore,
  isAutomationContext,
  shouldAutoStartTour,
} from "./tour-store";

function fakeStorage(initial: string | null = null) {
  let value = initial;
  return {
    storage: {
      get: () => value,
      set: (next: string | null) => {
        value = next;
      },
    },
    read: () => value,
  };
}

describe("createTourStore", () => {
  it("starts inactive and activates on the first step", () => {
    const store = createTourStore();
    expect(store.getSnapshot()).toEqual({ active: false, index: 0 });
    store.start();
    expect(store.getSnapshot()).toEqual({ active: true, index: 0 });
  });

  it("advances and goes back, clamping prev at the first step", () => {
    const store = createTourStore();
    store.start();
    store.next();
    store.next();
    expect(store.getSnapshot()).toEqual({ active: true, index: 2 });
    store.prev();
    expect(store.getSnapshot()).toEqual({ active: true, index: 1 });
    store.prev();
    store.prev();
    expect(store.getSnapshot()).toEqual({ active: true, index: 0 });
  });

  it("finishes when next is called on the last step and persists the marker", () => {
    const { storage, read } = fakeStorage();
    const steps = tourStepsFor({ chatEnabled: false });
    const store = createTourStore({ storage, steps });
    store.start();
    for (let index = 0; index < steps.length - 1; index += 1) store.next();
    expect(store.getSnapshot()).toEqual({ active: true, index: steps.length - 1 });
    store.next();
    expect(store.getSnapshot()).toEqual({ active: false, index: 0 });
    expect(read()).toBe(TOUR_VERSION);
    expect(store.isDone()).toBe(true);
  });

  it("skip finishes the tour and persists the marker", () => {
    const { storage, read } = fakeStorage();
    const store = createTourStore({ storage });
    store.start();
    store.next();
    store.skip();
    expect(store.getSnapshot()).toEqual({ active: false, index: 0 });
    expect(read()).toBe(TOUR_VERSION);
    expect(store.isDone()).toBe(true);
  });

  it("replays from the first step after the tour was seen", () => {
    const { storage } = fakeStorage();
    const store = createTourStore({ storage });
    store.skip();
    expect(store.isDone()).toBe(true);
    store.start();
    expect(store.getSnapshot()).toEqual({ active: true, index: 0 });
  });

  it("treats only the current marker as done", () => {
    expect(createTourStore().isDone()).toBe(false);
    expect(createTourStore({ storage: fakeStorage("0").storage }).isDone()).toBe(false);
    expect(createTourStore({ storage: fakeStorage('{"seen":true}').storage }).isDone()).toBe(false);
    expect(createTourStore({ storage: fakeStorage(TOUR_VERSION).storage }).isDone()).toBe(true);
  });

  it("round-trips the marker through the injected storage", () => {
    const { storage } = fakeStorage();
    createTourStore({ storage }).skip();
    expect(createTourStore({ storage }).isDone()).toBe(true);
  });

  it("notifies on transitions and keeps snapshot identity between them", () => {
    const store = createTourStore();
    const initial = store.getSnapshot();
    expect(store.getSnapshot()).toBe(initial);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.start();
    expect(calls).toBe(1);
    const started = store.getSnapshot();
    expect(started).not.toBe(initial);
    expect(store.getSnapshot()).toBe(started);

    store.prev();
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(started);

    unsubscribe();
    store.next();
    expect(calls).toBe(1);
  });

  it("uses the storage key the entry points share", () => {
    expect(TOUR_STORAGE_KEY).toBe("vv.ide-tour");
  });
});

describe("isAutomationContext", () => {
  it("is false without a navigator or for a regular browser", () => {
    expect(isAutomationContext(undefined)).toBe(false);
    expect(isAutomationContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
  });

  it("detects WebDriver", () => {
    expect(isAutomationContext({ webdriver: true, userAgent: "Mozilla/5.0" })).toBe(true);
  });

  it("detects HeadlessChrome", () => {
    expect(isAutomationContext({ userAgent: "Mozilla/5.0 HeadlessChrome/120.0.0.0" })).toBe(true);
  });
});

describe("shouldAutoStartTour", () => {
  const firstRun = { isAutomation: false, tourDisabled: false };

  it("allows a first run", () => {
    expect(shouldAutoStartTour({ isDone: () => false }, firstRun)).toBe(true);
  });

  it("blocks when the tour was seen, the browser is automated or the tour is disabled", () => {
    expect(shouldAutoStartTour({ isDone: () => true }, firstRun)).toBe(false);
    expect(shouldAutoStartTour({ isDone: () => false }, { ...firstRun, isAutomation: true })).toBe(
      false,
    );
    expect(shouldAutoStartTour({ isDone: () => false }, { ...firstRun, tourDisabled: true })).toBe(
      false,
    );
  });
});
