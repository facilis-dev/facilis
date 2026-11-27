// ide/ ships no jsdom: Home's top-layer contract is asserted on the static markup — the
// overlay marker the shortcut dispatcher reads, the announced view change, and the real
// heading focus can land on. Focus movement itself is the manual step (pnpm ide:smoke).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { IdeController, IdeSnapshot } from "@/vv/controller";
import { IdeContext } from "./useIde";
import { HomeView } from "./Home";

function render(): string {
  const snap = {
    view: "home",
    kernelReady: true,
    bootError: null,
    bootPhase: "",
    bootDone: 0,
    bootTotal: 0,
    workspaceFolders: [],
    recentProjects: [],
  } as unknown as IdeSnapshot;
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snap,
  } as unknown as IdeController;
  return renderToStaticMarkup(
    <IdeContext.Provider value={controller}>
      <HomeView />
    </IdeContext.Provider>,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("HomeView", () => {
  it("is the blocking overlay and announces the view change", () => {
    const html = render();
    expect(html).toContain("data-blocking-overlay");
    expect(html).toContain('role="status"');
    expect(html).toContain(t("home.viewAnnouncement"));
  });

  it("offers a real heading to land on (the brand lockup is decorative)", () => {
    const html = render();
    expect(html).toContain("<h1");
    expect(html).toContain(t("home.heading"));
    expect(html).toContain('tabindex="-1"');
  });
});
