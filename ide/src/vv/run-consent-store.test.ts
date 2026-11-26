import { afterEach, describe, expect, it, vi } from "vitest";

const media = (coarse: boolean) => (query: string) => ({
  matches: coarse && (query.includes("pointer: coarse") || query.includes("hover: none")),
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
});

async function storeWith(patch: { coarse: boolean }) {
  vi.resetModules();
  vi.stubGlobal("matchMedia", media(patch.coarse));
  return await import("./run-consent");
}

describe("run consent store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks on a touch device, then starts and stays granted for the tab", async () => {
    const store = await storeWith({ coarse: true });
    expect(store.requestRunConsent("/projects/app")).toBe(true);
    expect(store.getPendingRun()).toBe("/projects/app");
    expect(store.grantRunConsent()).toBe("/projects/app");
    expect(store.getPendingRun()).toBeNull();
    // The grant is what keeps the second pass from re-parking the request.
    expect(store.requestRunConsent("/projects/app")).toBe(false);
  });

  it("never asks on a desktop", async () => {
    const store = await storeWith({ coarse: false });
    expect(store.requestRunConsent("/projects/app")).toBe(false);
    expect(store.getPendingRun()).toBeNull();
  });

  it("declining clears the request without granting it", async () => {
    const store = await storeWith({ coarse: true });
    expect(store.requestRunConsent("/projects/app")).toBe(true);
    store.declineRunConsent();
    expect(store.getPendingRun()).toBeNull();
    expect(store.requestRunConsent("/projects/app")).toBe(true);
  });

  it("notifies subscribers for the request, the grant and the decline", async () => {
    const store = await storeWith({ coarse: true });
    let seen = 0;
    const unsubscribe = store.subscribeRunConsent(() => {
      seen += 1;
    });
    store.requestRunConsent("/a");
    store.grantRunConsent();
    store.declineRunConsent();
    unsubscribe();
    expect(seen).toBe(2);
  });
});
