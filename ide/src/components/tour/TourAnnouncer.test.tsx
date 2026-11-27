// Static-render test for the tour's live region (issue #218): the counter, title and body
// are one polite announcement built from the same catalogue keys the card renders.
// Real screen-reader output and step changes need a browser, so those stay manual.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { TourStep } from "@/tour/tour-types";
import { TourAnnouncer } from "./TourAnnouncer";

const STEP: TourStep = {
  id: "activity",
  anchor: "activity",
  action: "showExplorer",
  placement: "right",
  titleKey: "tour.step.activity.title",
  bodyKey: "tour.step.activity.body",
};

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("TourAnnouncer", () => {
  it("announces the counter, title and body together in a polite live region", () => {
    const html = renderToStaticMarkup(<TourAnnouncer step={STEP} index={1} total={6} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain(t("tour.stepOf", { current: 2, total: 6 }));
    expect(html).toContain(t(STEP.titleKey));
    expect(html).toContain(t(STEP.bodyKey));
  });
});
