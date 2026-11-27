// ide/ ships no jsdom: the boot and share covers are asserted on their static markup — the
// live region a screen reader announces from, the blocking marker the shortcut dispatcher
// reads, and the focusable root that takes focus on open. The actual focus move and the Tab
// walk are the manual ide:smoke step in the issue.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { IdeController, IdeSnapshot } from "@/vv/controller";
import { BootStatus } from "./BootStatus";
import { ProjectBootOverlay } from "./ProjectBootOverlay";
import { ShareLoadingOverlay } from "./ShareLoadingOverlay";
import { IdeContext } from "./useIde";

const booting = {
  bootError: null,
  bootPhase: "restore",
  bootDone: 4,
  bootTotal: 10,
};

function render(node: ReactNode, snap: Partial<IdeSnapshot>): string {
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snap as IdeSnapshot,
  } as unknown as IdeController;
  return renderToStaticMarkup(<IdeContext.Provider value={controller}>{node}</IdeContext.Provider>);
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("boot and share covers", () => {
  it("announces the boot phase in a live region", () => {
    const html = render(<BootStatus />, booting);
    expect(html).toContain('role="status"');
    expect(html).toContain(t("boot.restoring"));
  });

  it("makes the project boot cover a focusable blocking layer", () => {
    const html = render(<ProjectBootOverlay />, { ...booting, bootProject: "/tmp/demo-app" });
    expect(html).toContain("data-blocking-overlay");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="status"');
    expect(html).toContain(t("boot.openingTitle", { name: "demo-app" }));
  });

  it("makes the share cover a focusable blocking layer that announces its status", () => {
    const html = render(<ShareLoadingOverlay />, { shareMessage: t("overlays.share.booting") });
    expect(html).toContain("data-blocking-overlay");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="status"');
    expect(html).toContain(t("overlays.share.opening"));
    expect(html).toContain(t("overlays.share.booting"));
  });
});
