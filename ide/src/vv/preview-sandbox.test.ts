import { describe, expect, it } from "vitest";
import {
  ISOLATED_PREVIEW_SANDBOX,
  SAME_ORIGIN_PREVIEW_SANDBOX,
  previewSandbox,
} from "./preview-sandbox";

describe("preview sandbox", () => {
  it("keeps the IDE's origin only for a same-origin preview", () => {
    expect(previewSandbox(false)).toContain("allow-same-origin");
    expect(previewSandbox(true)).not.toContain("allow-same-origin");
  });

  it("keeps the capabilities the preview needs in both modes", () => {
    for (const sandbox of [SAME_ORIGIN_PREVIEW_SANDBOX, ISOLATED_PREVIEW_SANDBOX]) {
      for (const token of ["allow-scripts", "allow-forms", "allow-popups", "allow-modals"]) {
        expect(sandbox).toContain(token);
      }
    }
  });
});
