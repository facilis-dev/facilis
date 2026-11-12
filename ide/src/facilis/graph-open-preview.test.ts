import { describe, expect, it, vi } from "vitest";
import type { IdeController } from "@/vv/controller";
import { openPageInPreview } from "./graph-open-preview";

// The helper only touches togglePreview and the preview session; a narrow fake keeps the test
// browser-free while still type-checking the controller seam through the documented cast.
function controllerWith(active: { id: string; port: number } | null) {
  const togglePreview = vi.fn();
  const navigatePreviewPath = vi.fn();
  const addPreviewTab = vi.fn(() => "pv2");
  const controller = {
    togglePreview,
    preview: {
      activePreviewTab: () => (active === null ? null : { ...active, path: "/", nonce: 1 }),
      navigatePreviewPath,
      addPreviewTab,
    },
  } as unknown as IdeController;
  return { controller, togglePreview, navigatePreviewPath, addPreviewTab };
}

describe("openPageInPreview", () => {
  it("reveals the panel and navigates the bound preview tab", () => {
    const fake = controllerWith({ id: "pv1", port: 3000 });
    openPageInPreview(fake.controller, "/todos");
    expect(fake.togglePreview).toHaveBeenCalledWith(true);
    expect(fake.navigatePreviewPath).toHaveBeenCalledWith("pv1", "/todos");
    expect(fake.addPreviewTab).not.toHaveBeenCalled();
  });

  it("adds a tab that already carries the path when no server is running", () => {
    const fake = controllerWith(null);
    openPageInPreview(fake.controller, "/todos");
    expect(fake.addPreviewTab).toHaveBeenCalledWith("", "/todos");
    expect(fake.navigatePreviewPath).not.toHaveBeenCalled();
  });

  it("substitutes path parameters with a concrete placeholder", () => {
    const fake = controllerWith({ id: "pv1", port: 3000 });
    openPageInPreview(fake.controller, "/todos/:id");
    expect(fake.navigatePreviewPath).toHaveBeenCalledWith("pv1", "/todos/1");
  });

  it("does nothing for a wildcard or non-absolute path", () => {
    const fake = controllerWith({ id: "pv1", port: 3000 });
    openPageInPreview(fake.controller, "/todos/*");
    openPageInPreview(fake.controller, "todos");
    expect(fake.togglePreview).not.toHaveBeenCalled();
    expect(fake.navigatePreviewPath).not.toHaveBeenCalled();
  });
});
