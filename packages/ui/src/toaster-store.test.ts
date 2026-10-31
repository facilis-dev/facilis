import { afterEach, describe, expect, it, vi } from "vitest";

// Each test gets a fresh module instance, so the module-level toast queue starts empty.
async function freshStore(): Promise<typeof import("./toaster-store.ts")> {
  vi.resetModules();
  return import("./toaster-store.ts");
}

describe("toast store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a toast and dismisses it exactly four seconds later", async () => {
    vi.useFakeTimers();
    const store = await freshStore();

    store.toast("Saved");
    expect(store.getToasts()).toHaveLength(1);
    expect(store.getToasts()[0]?.message).toBe("Saved");
    expect(store.getToasts()[0]?.tone).toBe("info");

    vi.advanceTimersByTime(3_999);
    expect(store.getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.getToasts()).toHaveLength(0);
  });

  it("maps the tone methods and keeps insertion order", async () => {
    vi.useFakeTimers();
    const store = await freshStore();

    store.toast.info("a");
    store.toast.success("b");
    store.toast.warning("c");
    store.toast.error("d");

    expect(store.getToasts().map((item) => item.tone)).toEqual([
      "info",
      "success",
      "warning",
      "error",
    ]);
    expect(store.getToasts().map((item) => item.message)).toEqual(["a", "b", "c", "d"]);
  });

  it("notifies subscribers on queue and dismiss, and stops after unsubscribe", async () => {
    vi.useFakeTimers();
    const store = await freshStore();
    let calls = 0;

    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.toast("one");
    expect(calls).toBe(1);

    vi.advanceTimersByTime(4_000);
    expect(calls).toBe(2);

    unsubscribe();
    store.toast("two");
    expect(calls).toBe(2);
  });
});
