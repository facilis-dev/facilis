// Static-render test for the card that receives the tour's programmatic focus (issue #218):
// the move has to be visible through the design-system focus ring, and the card must not keep
// a second live region now that the overlay announces the whole step. Focus movement itself
// needs a browser (pnpm ide:smoke).

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import type { TourStep } from "@/tour/tour-types";
import { TourCard } from "./TourCard";

const STEP: TourStep = {
  id: "graph",
  anchor: null,
  action: "none",
  placement: "top",
  titleKey: "tour.step.graph.title",
  bodyKey: "tour.step.graph.body",
};

const render = () =>
  renderToStaticMarkup(
    <TourCard
      step={STEP}
      index={0}
      total={2}
      placement={null}
      cardSize={{ width: 0, height: 0 }}
      top={0}
      left={0}
      cardRef={{ current: null }}
      onNext={vi.fn()}
      onPrev={vi.fn()}
      onSkip={vi.fn()}
    />,
  );

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("TourCard", () => {
  it("wears the design-system focus ring instead of killing the outline", () => {
    const html = render();
    const cardTag = html.match(/<div[^>]*data-placement="[^"]*"[^>]*>/)?.[0] ?? "";
    expect(cardTag).toContain("focus-visible:ring-3");
    expect(cardTag).toContain("focus-visible:ring-ring/50");
    expect(cardTag).not.toContain("outline-none");
  });

  it("leaves the announcement to the overlay's live region", () => {
    expect(render()).not.toContain("aria-live");
  });
});
