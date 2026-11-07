import { describe, expect, it } from "vitest";
import type { IdeSnapshot } from "@/vv/controller";
import type { KernelBridge } from "@/vv/kernel";
import { devBase, devEndpointUrl } from "./dev-base";

const bridge = {
  sameOriginPreviewUrl: (port: number, pathAndQuery = "/") =>
    "/preview/" + port + pathAndQuery + "?__vv_kernel=tok123",
} as unknown as KernelBridge;

function snapshot(overrides: Partial<IdeSnapshot>): IdeSnapshot {
  return {
    previewTabs: [],
    activePreviewId: null,
    ports: [],
    ...overrides,
  } as unknown as IdeSnapshot;
}

const tab = (id: string, port: number | null) => ({
  id,
  url: "",
  port,
  path: "/",
  nonce: 1,
});

describe("devBase", () => {
  it("prefers the active preview tab's port", () => {
    const base = devBase(
      bridge,
      snapshot({
        activePreviewId: "b",
        previewTabs: [tab("a", 3000), tab("b", 5173)] as IdeSnapshot["previewTabs"],
        ports: [{ port: 9999, pid: 1 }],
      }),
    );
    expect(base).toBe("/preview/5173/?__vv_kernel=tok123");
  });

  it("falls back to the first preview tab with a port when the active one has none", () => {
    const base = devBase(
      bridge,
      snapshot({
        activePreviewId: "a",
        previewTabs: [tab("a", null), tab("b", 5173)] as IdeSnapshot["previewTabs"],
      }),
    );
    expect(base).toBe("/preview/5173/?__vv_kernel=tok123");
  });

  it("falls back to the single listening port when no preview tab is bound", () => {
    const base = devBase(bridge, snapshot({ ports: [{ port: 3000, pid: 7 }] }));
    expect(base).toBe("/preview/3000/?__vv_kernel=tok123");
  });

  it("is null when there is no unambiguous port", () => {
    expect(devBase(bridge, snapshot({}))).toBeNull();
    expect(
      devBase(
        bridge,
        snapshot({
          ports: [
            { port: 3000, pid: 7 },
            { port: 3001, pid: 8 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("never returns an empty string", () => {
    expect(devBase(bridge, snapshot({ ports: [{ port: 1, pid: 1 }] }))).not.toBe("");
  });
});

describe("devEndpointUrl", () => {
  it("inserts the path before the kernel token", () => {
    expect(devEndpointUrl("/preview/5173/?__vv_kernel=abc", "/__facilis/dev/query")).toBe(
      "/preview/5173/__facilis/dev/query?__vv_kernel=abc",
    );
  });

  it("adds the missing trailing slash to the base path", () => {
    expect(devEndpointUrl("/preview/5173?__vv_kernel=abc", "/__facilis/dev/view")).toBe(
      "/preview/5173/__facilis/dev/view?__vv_kernel=abc",
    );
  });

  it("keeps a hash in place", () => {
    expect(devEndpointUrl("/preview/5173/?__vv_kernel=abc#x", "/__facilis/dev/query")).toBe(
      "/preview/5173/__facilis/dev/query?__vv_kernel=abc#x",
    );
  });

  it("accepts a path without a leading slash and a plain base", () => {
    expect(devEndpointUrl("http://host/preview/3000/", "__facilis/dev/query")).toBe(
      "http://host/preview/3000/__facilis/dev/query",
    );
  });

  it("stays root-relative for an empty base", () => {
    expect(devEndpointUrl("", "/__facilis/dev/schema")).toBe("/__facilis/dev/schema");
  });
});
